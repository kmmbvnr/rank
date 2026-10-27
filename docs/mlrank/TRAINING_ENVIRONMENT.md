# mlRank: Интерактивная среда обучения и визуализации

Документ описывает требования и архитектуру интерактивной среды для машинного обучения в Rank: модуль визуализации (`use viz`), потоковый мониторинг процесса обучения (Live Training Dashboard), специализированные ML-инспекторы и необходимые рантайм-компоненты для дифференцирования и оптимизации.

---

## 1. Концепция `use viz`: Графики как первоклассные значения

В Rank визуализация не должна опираться на тяжелые внешние библиотеки с императивным мутабельным состоянием (вроде `matplotlib`). График является **чистым значением (First-Class Value)** — структурированным `record`, описывающим данные, тип представления и разметку осей.

Среда исполнения (`NotebookRepl` в веб-консоли или CLI-терминале) отвечает за проекцию этого значения в визуальную форму.

```rank
use viz

rem 1. Линейный график кривой лосса (Line Plot)
LossHistory = [2.45, 1.89, 1.42, 1.10, 0.85, 0.72]
LossPlot = LossHistory plot.line title: "Training Loss" xlabel: "Epoch"

rem 2. Гистограмма распределения весов (Weight Distribution)
Weights flat plot.hist bins: 50 title: "Layer 1 Weights"

rem 3. Тепловая карта внимания (Attention Heatmap)
AttnScores plot.heatmap xlabels: Tokens ylabels: Tokens colormap: .viridis

rem 4. Тензор как изображение (Computer Vision)
rem Тензор формы [H, W] (градации серого) или [H, W, 3] (RGB)
ImageTensor plot.image
```

---

## 2. Потоковый мониторинг обучения (Live Streaming Dashboard)

В процессе обучения модели цикл выполняет сотни или тысячи итераций. Полная перерисовка ячеек ноутбука на каждом шаге приводит к деградации производительности.

Для этого в `NotebookRepl` вводится примитив **потокового обновления ячейки** (Streaming Cell):

```rank
use viz

rem Создание реактивного дашборда метрик
Dashboard = viz.monitor
  .loss = viz.line title: "Loss" xlabel: "Step"
  .lr   = viz.line title: "Learning Rate" xlabel: "Step"
end

for step in 0 till 1000
  rem ... Шаг прямого и обратного прохода ...
  Dashboard.loss push step CurrentLoss
  Dashboard.lr   push step CurrentLR
end
```

### Архитектура передачи данных:
* **Web-консоль ([`packages/web`](file:///Users/kmmbvnr/Workspace/Playground/09-Rank/packages/web)):** Worker инференса пушит диффы через легковесные сообщения `postMessage`, обновляя SVG/Canvas-буфер без триггера повторного рендера дерева DOM всего документа.
* **Терминальный CLI ([`packages/cli`](file:///Users/kmmbvnr/Workspace/Playground/09-Rank/packages/cli)):** Использование ANSI-последовательностей позиционирования курсора для перезаписи фиксированной области экрана со сглаживанием по символам Брайля.

---

## 3. Специализированные ML-инспекторы

Для глубокого обучения недостаточно классических графиков X/Y. Требуются специализированные диагностические инструменты:

### 3.1. Инспектор карт внимания (Attention Head Explorer)
* **Назначение:** Анализ самовнимания в трансформерах.
* **Поведение:** Интерактивная 2D-матрица токенов. При наведении курсора на конкретный токен в строке подсвечиваются веса внимания к остальным токенам в столбцах. Возможность переключения между головами (Heads 0..11) и слоями (Layers 0..11).

### 3.2. Диагностика «здоровья» градиентов и весов (Model Health Check)
* **Автоматическое выявление аномалий:**
  * Индикатор **Dead Neurons** (процент нулей после `relu` / `gelu`).
  * Индикатор **Vanishing / Exploding Gradients**: норма вектора градиентов $\|\nabla W\|$ по слоям.
  * Мгновенный алерт при появлении `NaN` или `Inf` в любом промежуточном тензоре с указанием точной строки `.ram`, где произошел сбой.

### 3.3. Подсветка уверенности генерации (Token Confidence Highlighter)
* **Назначение:** Инспекция авторегрессионного вывода языковых моделей.
* **Поведение:** Текст генерируется с фоновой раскраской токенов в зависимости от вероятности $p$, полученной из `softmax`:
  * **Зелёный ($p \ge 0.85$):** Высокая уверенность модели.
  * **Жёлтый ($0.4 \le p < 0.85$):** Альтернативные варианты с близкой вероятностью.
  * **Красный ($p < 0.4$):** Высокая энтропия / неуверенность.

### 3.4. Матрица ошибок (Confusion Matrix)
* **Назначение:** Оценка задач классификации.
* **Синтаксис:**
  ```rank
  Predictions Targets plot.confusion labels: ClassNames
  ```

---

## 4. Двойной рендеринг: Web Console vs. Terminal CLI

Среда Rank едина для браузера и терминала, поэтому визуализатор поддерживает два бэкенда:

| Тип вывода | Web Console / Mobile (`@arrrank/web`) | Терминал CLI (`@arrrank/cli`) |
| :--- | :--- | :--- |
| **Line / Scatter** | Векторный SVG с интерактивным тултипом | Символы Брайля (`Braille 2x4` точки: `⡀⠄⠂⠁`) |
| **Heatmap** | HTML5 Canvas с градиентной шкалой | 256-цветные / TrueColor ANSI-блоки (`█`, `▀`) |
| **Images** | `<img>` через Data-URL / WebGL | Протокол Sixel / Kitty Graphics / ASCII-арт |
| **Интерактивность** | Drag, Zoom, наведение курсора, срез слоёв | Текстовые срезы и постраничная навигация клавишами |

---

## 5. Требования к вычислительному рантайму для обучения

Чтобы замкнуть цикл «разработка $\rightarrow$ обучение $\rightarrow$ инференс $\rightarrow$ визуализация», в рантайм `mlRank` закладываются следующие механизмы:

### 5.1. Автоматическое дифференцирование (Autograd)
* Построение обратного вычислительного графа (Reverse-Mode AD).
* Для каждой элементарной операции forward-графа (`matmul`, `conv2d`, `layernorm`, `gelu`) генератор порождает парный backward-узел с вычислением градиентов по входам и весам.

### 5.2. Библиотека оптимизаторов (`use ml/optim`)
* Стандартные алгоритмы оптимизации первого порядка:
  * `sgd` (со сглаживанием / Momentum).
  * `adamw` (с адаптивными моментами $m, v$ и L2-weight decay).
* Размещение состояния оптимизатора (буферы моментов) непосредственно в статической памяти акселератора рядом с весами модели.

### 5.3. Чекпоинтинг моделей
* Сохранение и загрузка снимков обучения (веса + шаг + оптимизатор) без накладных расходов на сериализацию (стандарт `.safetensors` / zero-copy memory-mapped файлы).

---

## 6. Пример сквозного скрипта обучения в Rank

```rank
rem train_classifier.ra
use ml
use viz
use "convnet.ram" as Model

Data = load_dataset "cifar10.table"
LossPlot = viz.line title: "Loss" xlabel: "Batch"
AccPlot  = viz.line title: "Accuracy" xlabel: "Batch"

Optimizer = Model.weights adamw lr: 1e-3 weight_decay: 1e-4

for epoch in 0 till 10
  for Batch in (Data batches 64)
    rem 1. Прямой проход на NPU/GPU
    Logits = Batch.images Model.forward
    Loss = Logits Batch.labels cross_entropy

    rem 2. Обратный проход и шаг градиентного спуска
    Grads = Loss.backward
    Optimizer step Grads

    rem 3. Живая телеметрия в дашборд
    LossPlot push Loss.value
    AccPlot  push (Logits Batch.labels accuracy)
  end
end

rem Визуализация результатов на проверочной выборке
Confusion = TestPredictions TestLabels plot.confusion labels: ClassNames
```
