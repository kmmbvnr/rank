# mlRank: Прототипирование компилятора и дорожная карта до GPT-2

Текущий прототип задач 1–3 (ReLU, константы и двумерный linear с запечёнными весами), команды запуска и ограничения описаны в
[Implemented Hello World subset](README.md#implemented-hello-world-subset).
Последующие задачи и отдельные CoreML/NPU-бэкенды остаются планом.

Документ описывает пошаговый план создания JIT-компилятора `mlRank` (`.ram`) с компиляцией «на лету» в **CoreML** (Apple Neural Engine / Metal), **LiteRT** (Google Android NPU / GPU) и **ONNX**, начиная от базового «Hello World» для NPU и заканчивая запуском полнотекстовой авторегрессионной модели **GPT-2**.

> Подробная архитектура компиляции CoreML на лету прямо на устройствах iPhone/iPad (без Mac) описана в [CoreML JIT на iOS](IOS_COREML.md).  
> Концепция интерактивной среды обучения и визуализации (`use viz`) описана в [Среда обучения и визуализация](TRAINING_ENVIRONMENT.md).

---

## 1. Специфика NPU и философия «Hello World»

В традиционном программировании «Hello World» — это вывод строки, в численных CPU-расчётах — векторное сложение `y = a + b`.

В мире нейроускорителей (NPU/TPU/ANE):
* NPU не поддерживают произвольные динамические аллокации в рантайме.
* Требуется заранее размеченная статическая память (arena / static SRAM schedule).
* Размеры тензоров должны быть кратны аппаратным границам векторизации (16, 32, 64 байта).
* Нет произвольного ветвления (`if`/`while` на тензорах сбрасывают выполнение на CPU).

Поэтому **«Hello World» для NPU-компилятора — это поэлементный оператор активации (`ReLU` или `X * 2.0`) на тензоре фиксированной статической формы**:

```rank
rem hello.ram
use ml

option X .f16 shape 1 64
return X relu
```

Этот тест проверяет всю сквозную цепочку:
1. Парсинг `.ram` (типы прецизии `.f16`, контракт `shape`).
2. Построение промежуточного представления (SSA IR).
3. Кодогенерация целевого формата (CoreML MIL, LiteRT FlatBuffer, ONNX Protobuf).
4. Выделение аппаратных тензорных буферов (Metal Buffer, LiteRT TensorBuffer, OrtValue).
5. Исполнение на физическом ускорителе и сверка результатов с эталонным CPU-интерпретатором Rank (`atol <= 1e-4`).

---

## 2. Фаза 1: Фундамент компилятора (Шаги 1–10)

Первые 10 задач выстраивают базовые операторы, управление памятью и сквозной конвейер компиляции.

```
[1. Hello World (ReLU)] 
       │
[2. Baked Weights] ──► [3. GEMM / Linear] ──► [4. Broadcasting]
                                                     │
[7. Static Loop Unrolling] ◄── [6. MLP Fusion] ◄── [5. Normalization]
       │
[8. Spatial Ops (Conv2D)] ──► [9. SDPA / Gather] ──► [10. Enumerated Shapes & INT8]
```

### Задача 1. Поэлементная активация (Hello World)
* **Код `.ram`:**
  ```rank
  use ml
  option X .f16 shape 1 64
  return X relu
  ```
* **Цель:** Базовая кодогенерация оператора (`Relu` / `mb.relu` / `RELU`), выделение буферов, запуск на чипе, считывание результата в Rank.

### Задача 2. Запекание весов и констант (`option = Default`)
* **Код `.ram`:**
  ```rank
  use ml
  option X .f32 shape 1 64
  option Scale .f32 shape 1 64 = array shape 1 64 fill 2.0
  option Bias  .f32 shape 1 64 = array shape 1 64 fill 0.5
  return (X * Scale) + Bias
  ```
* **Цель:** Разделение runtime-входов (динамические тензоры параметров) и запекаемых весов (Initializers в ONNX, FlatBuffer Buffer в LiteRT, `mb.const` в MIL). Оффлайн-упаковка весов в память модели.

### Задача 3. Аппаратное матричное умножение (GEMM / `linear`)
* **Код `.ram`:**
  ```rank
  use ml
  option X .f32 shape 1 64
  option W .f32 shape 64 128 = array shape 64 128 fill 0.5
  return X W linear
  ```
* **Реализованный срез:** `X[M,K] × W[K,N] → [M,N]`, один runtime-вход и запечённые `.f32` веса. LiteRT `FULLY_CONNECTED` на GPU; некратные 16/32 размеры передаются без ручного padding. Формы проверяются до запуска.
* **За пределами среза:** `.f16` матричная арифметика, динамические веса, батчевые матрицы ранга > 2, отдельные AMX/Hexagon/NPU-бэкенды.

### Задача 4. Ранговый бродкастинг (`rank L R`)
* **Код `.ram`:**
  ```rank
  use ml
  option BatchScores .f16 shape 1 16 64
  option Bias .f16 shape 64
  return BatchScores + Bias
  ```
* **Цель:** В Rank сложение векторов и матриц опирается на семантику рамок (frame broadcasting). Компилятор должен автоматически синтезировать статические `reshape` / `expand_dims` до `[1, 1, 64]`, так как NPU требуют явных правил бродкастинга.

### Задача 5. Векторные нормализации (`softmax`, `rmsnorm`)
* **Код `.ram`:**
  ```rank
  use ml
  option X .f16 shape 1 64
  return (X 1e-5 rmsnorm)
  ```
* **Цель:** Реализация операторов ранга 1 (нормализация по последней оси). Сравнение нативных инструкций (`mb.rms_norm` в CoreML) с декомпозицией в подграф (`Mean` + `Rsqrt` + `Mul` в LiteRT и ONNX).

### Задача 6. Двухслойный MLP со слиянием (Operator Fusion)
* **Код `.ram`:**
  ```rank
  use ml
  option X .f16 shape 1 64
  option W1 .f16 shape 64 256
  option W2 .f16 shape 256 64
  H = (X W1 linear) gelu
  return (H W2 linear)
  ```
* **Цель:** Анализ времени жизни промежуточных тензоров (SSA Liveness) и переиспользование памяти тензорной арены. Проверка автоматического слияния `MatMul + GELU` компилятором NPU.

### Задача 7. Статическое разворачивание циклов (`for i in 0 till N`)
* **Код `.ram`:**
  ```rank
  use ml
  option X .f16 shape 1 64
  option Weights .f16 shape 4 64 64
  H = X
  for i in 0 till 4
    W = Weights i
    H = H + (H W linear)
  end
  return H
  ```
* **Цель:** Преобразование синтаксического цикла с константными границами в линейный статический SSA-граф во время компиляции (NPU не поддерживают динамические счетчики циклов).

### Задача 8. Свертки и трансформация раскладки памяти (`NCHW` vs `NHWC`)
* **Код `.ram`:**
  ```rank
  use ml
  option Img .f16 shape 1 28 28 1
  option K .f16 shape 3 3 1 16
  return (Img K conv2d stride 1 padding 1) relu
  ```
* **Цель:** Преодоление несовместимости форматов: CoreML ANE требует `NCHW` (channels-first), LiteRT NPU требует `NHWC` (channels-last). Компилятор должен прозрачно переставлять оси весов и входов.

### Задача 9. Scaled Dot-Product Attention и индексация (`gather`)
* **Код `.ram`:**
  ```rank
  use ml
  option Q .f16 shape 1 16 64
  option K .f16 shape 1 16 64
  option V .f16 shape 1 16 64
  return Q K V attention
  ```
* **Цель:** Компиляция макро-инструкций внимания (`mb.scaled_dot_product_attention` в CoreML, оптимизированный подграф в LiteRT) и выборка по таблице (`gather` для токенов).

### Задача 10. Перечислимые формы (`shape ... end`) и квантование (`.i8`)
* **Код `.ram`:**
  ```rank
  use ml
  option Tokens .i32 shape
    1 64
    1 128
    1 256
  end
  ```
* **Цель:** Поддержка нескольких профилей формы без перекомпиляции:
  * В CoreML: `ct.EnumeratedShapes`.
  * В LiteRT: Multi-Signature FlatBuffer с общим пулом весов.
  * Выполнение квантованных графов INT8/FP8.

---

## 3. Фаза 2: Дорожная карта до полнотекстового GPT-2 (Шаги 11–20)

Архитектура GPT-2 (12 слоев, 12 голов, 768 скрытая размерность, словарь 50257) требует поддержки точных механизмов трансформеров: каузальной маски, разделения голов, кэширования ключей/значений (KV-Cache) и авторегрессионного цикла.

```
[11. LayerNorm (Affine)] ──► [12. Split / Concat QKV] ──► [13. Causal Mask]
                                                                  │
[16. Transformer Block] ◄── [15. MLP (GELU approx)] ◄── [14. Multi-Head Attention]
       │
[17. Unembedding / LM Head] ──► [18. 12-Layer Stack & Importer]
                                       │
[20. Generation Loop (Host)] ◄── [19. Autoregressive KV-Cache]
```

### Задача 11. Аффинный LayerNorm с обучаемыми $\gamma$ и $\beta$
* **Отличие от RMSNorm:** В GPT-2 используется полный `LayerNorm` с вычитанием среднего, делением на дисперсию и применением двух параметров: скейла ($\gamma$) и сдвига ($\beta$):
  $$y = \frac{x - \mu}{\sqrt{\sigma^2 + \epsilon}} \cdot \gamma + \beta$$
* **Код `.ram`:**
  ```rank
  use ml
  option X .f16 shape 1 64 768
  option Gamma .f16 shape 768 = array shape 768 fill 1.0
  option Beta  .f16 shape 768 = array shape 768 fill 0.0
  return (X 1e-5 layernorm) * Gamma + Beta
  ```
* **Цель компилятора:** Распознавание паттерна нормализации с масштабированием и трансляция в нативный узел (`mb.layer_norm` с весами в CoreML, `LAYER_NORM` в LiteRT).

### Задача 12. Расщепление и объединение тензоров (`split`, `slice`, `concat`)
* **Контекст:** В весах GPT-2 проекция $Q, K, V$ хранится единой матрицей `c_attn` формы `[768, 2304]`. Результат умножения имеет форму `[Batch, Seq, 2304]`, который необходимо расщепить на 3 части по 768, а затем разбить на 12 голов: `[Batch, 12, Seq, 64]`.
* **Код `.ram`:**
  ```rank
  use ml
  option QKV .f16 shape 1 64 2304
  rem Разделение на 3 среза и изменение формы под головы
  Q = QKV slice 0 768 axis 2 reshape 1 64 12 64 transpose 0 2 1 3
  K = QKV slice 768 1536 axis 2 reshape 1 64 12 64 transpose 0 2 1 3
  V = QKV slice 1536 2304 axis 2 reshape 1 64 12 64 transpose 0 2 1 3
  return record .q = Q .k = K .v = V end
  ```
* **Цель компилятора:** Оптимизация срезов памяти без лишних копирований (нолевое копирование через Strided View на NPU).

### Задача 13. Каузальная маска внимания (Causal Triangular Mask)
* **Контекст:** Токены не должны «заглядывать в будущее». Матрица внимания $QK^T$ складывается с верхней треугольной маской, где будущие позиции содержат $-10000.0$ (или $-\infty$).
* **Код `.ram`:**
  ```rank
  use ml
  option Scores .f16 shape 1 12 64 64
  option Mask .f16 shape 64 64 = array ... rem Нижний треугольник 0.0, верхний -1e4
  return (Scores + Mask) softmax
  ```
* **Цель компилятора:** Запекание треугольной константной маски в веса модели, избегая её динамического вычисления в рантайме.

### Задача 14. Полный блок Multi-Head Self-Attention (MHA)
* **Контекст:** Объединение шагов 12 и 13 в единый монолитный блок MHA:
  $$\text{MHA}(X) = \text{Concat}(\text{head}_1, \dots, \text{head}_h) W_O$$
* **Код `.ram`:**
  ```rank
  use ml
  option X .f16 shape 1 64 768
  option W_qkv .f16 shape 768 2304
  option B_qkv .f16 shape 2304
  option W_proj .f16 shape 768 768
  option B_proj .f16 shape 768

  QKV = (X W_qkv linear) + B_qkv
  rem ... MHA расчет ...
  Out = (AttnHeads W_proj linear) + B_proj
  return Out
  ```
* **Цель компилятора:** Генерация единого графа внимания с проекцией выхода и residual-связью.

### Задача 15. Блок MLP трансформера с аппроксимацией GELU
* **Контекст:** В GPT-2 используется аппроксимация GELU через tanh:
  $$\text{GELU}(x) = 0.5x \left(1 + \tanh\left(\sqrt{\frac{2}{\pi}} (x + 0.044715 x^3)\right)\right)$$
  Проекция $768 \rightarrow 3072 \rightarrow 768$.
* **Код `.ram`:**
  ```rank
  use ml
  option X .f16 shape 1 64 768
  option W_fc .f16 shape 768 3072
  option B_fc .f16 shape 3072
  option W_proj .f16 shape 3072 768
  option B_proj .f16 shape 768

  Hidden = ((X W_fc linear) + B_fc) gelu
  Out = (Hidden W_proj linear) + B_proj
  return Out
  ```
* **Цель компилятора:** Слияние расширения и сжатия размерности с активацией.

### Задача 16. Законченный трансформерный слой (GPT-2 Block)
* **Контекст:** Объединение Pre-LayerNorm, MHA, Residual, Pre-LayerNorm 2, MLP и второго Residual:
  $$H_1 = X + \text{MHA}(\text{LN}_1(X))$$
  $$\text{Block}(X) = H_1 + \text{MLP}(\text{LN}_2(H_1))$$
* **Код `.ram`:**
  ```rank
  rem block.ram
  option X .f16 shape 1 64 768
  H1 = X + (X BlockLN1 MHA)
  H2 = H1 + (H1 BlockLN2 MLP)
  return H2
  ```
* **Цель компилятора:** Проверка модульности: инлайнинг функций или подграфов в единый плоский DAG без оверхеда на вызовы функций.

### Задача 17. Слой эмбеддингов, позиций и проекция словаря (LM Head)
* **Контекст:**
  * Вход: вектор идентификаторов токенов `Tokens` (`shape 1 64`, `.i32`).
  * Позиции: вектор от `0` до `63`.
  * Эмбеддинги: $X_0 = \text{WTE}[\text{tokens}] + \text{WPE}[\text{positions}]$.
  * Выходная голова: $\text{Logits} = \text{LN}_f(H) \times \text{WTE}^T$ (размерность `[1, 64, 50257]`).
* **Цель компилятора:** Обработка большой матрицы словаря (50257 x 768 = ~38 млн параметров). Оптимизация размещения весов в памяти, чтобы избежать дублирования WTE при Weight Tying.

### Задача 18. Полный 12-слойный стек GPT-2 и конвертер весов
* **Контекст:**
  * Сборка всех 12 слоев в один `.ram`-модуль (через `for layer in 0 till 12` со статическим разворачиванием).
  * Написание утилиты-конвертера `rank-import-safetensors`: чтение оригинального `model.safetensors` из Hugging Face и сохранение бинарных буферов параметров для `.ram`.
* **Цель:** Полный статический граф GPT-2 (~124M параметров) компилируется в:
  * `gpt2.mlpackage` для Apple Neural Engine / Metal.
  * `gpt2.tflite` для LiteRT (CPU / GPU / NPU).
  * `gpt2.onnx` для валидации в ONNX Runtime.

### Задача 19. Статический KV-кэш для NPU (Autoregressive Token Generation)
* **Контекст:** Генерация токенов по одному требует сохранения предыдущих ключей и значений, чтобы не пересчитывать историю контекста заново на каждом шаге.
* **Специфика NPU:** NPU не может динамически менять форму тензора от шага к шагу. Поэтому создается статический кольцевой буфер максимального контекста (например, `1024`):
  ```rank
  option K_cache .f16 shape 12 1024 64
  option V_cache .f16 shape 12 1024 64
  option Pos .i32 shape 1
  option NewToken .i32 shape 1 1
  ```
* **Цель компилятора:** Реализация in-place записи нового среза $K_{new}, V_{new}$ по индексу `Pos` в статическую арену памяти NPU.

### Задача 20. Сквозной скрипт генерации текста на хосте (`main.ra`)
* **Контекст:** Окончательная интеграция между обычным скриптом Rank (`.ra`) и скомпилированным модулем ускорителя (`gpt2.ram`).
* **Код `.ra`:**
  ```rank
  rem main.ra
  use sequences
  use "gpt2.ram"

  Prompt = "The quick brown fox"
  Tokens = Prompt tokenize_bpe

  for step in 0 till 50
    Logits = Tokens gpt2
    NextToken = (Logits slice_last) max .index
    Tokens = Tokens ++ NextToken
  end

  Tokens decode_bpe print
  ```
* **Цель:** Демонстрация полной бесшовной экосистемы Rank: подготовка данных, ввод-вывод и BPE-токенизация происходят на хосте (в Rank CPU), а тяжелый шаг инференса модели выполняется на NPU на максимальной аппаратной скорости. Сверка сгенерированного текста с эталоном из PyTorch HuggingFace с точностью до последнего токена при жадном (greedy) сэмплировании.

---

## 4. Резюме: рекомендуемый порядок реализации

1. **Недели 1–2 (Задачи 1–5):** Поднять генерацию ONNX и запуск простейших плоских операций (Hello World, линейный слой, нормализации). Отладить передачу массивов между хостом и рантаймом.
2. **Недели 3–4 (Задачи 6–10):** Реализовать статический анализ DAG, слияние операторов и генерацию под CoreML / LiteRT. Добавить поддержку перечислимых форм.
3. **Недели 5–6 (Задачи 11–16):** Реализовать специфичные для трансформеров узлы: MHA, каузальную маску, расщепление голов и единичный GPT-2 блок.
4. **Недели 7–8 (Задачи 17–20):** Интеграция весов Safetensors, сборка 12-слойного графа, добавление статического KV-кэша и сквозная демонстрация авторегрессионного инференса.
