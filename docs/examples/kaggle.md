# Kaggle examples

Kaggle is used as a stress test for Rank's table, text, date and tensor design.

High-level ML model names in these examples are temporary conveniences. The
current goal is to implement important models such as logistic regression in
Rank itself.

## Titanic

Survival rate by sex and passenger class:

```rank
rem Kaggle: Titanic
rem Compute survival rate by
rem sex and passenger class.

use tables
use stats

Data = "train.csv" csv

Keys = .Sex .Pclass
Groups = Data Keys group
Rate = Groups .Survived mean

Rate print
```

Baseline feature preparation:

```rank
Median = Train .Age median
Train .Age = Train .Age pad Median
Test .Age = Test .Age pad Median

Train .Female =
  Train .Sex equal "female"

Test .Female =
  Test .Sex equal "female"

Features =
  array .Female .Pclass .Age .Fare

X = Train Features
Xtest = Test Features
```

The [runnable Titanic baseline](../../demos/kaggle/001_titanic.ra) implements
the preprocessing, logistic regression and submission output in Rank. Its
three positional paths default to ignored local directories:

```text
demos/kaggle/data/titanic/train.csv
demos/kaggle/data/titanic/test.csv
demos/kaggle/submissions/titanic.csv
```

The neighboring test uses small in-memory rows, so the repository test suite
does not require a Kaggle account or downloaded competition data.

## House Prices

Reusable feature selectors:

```rank
rem Kaggle: House Prices
rem Predict SalePrice.

Features =
  array .OverallQual .GrLivArea
  .Neighborhood .HouseStyle
  .KitchenQual .ExterQual

X = Train Features
Xtest = Test Features
```

`Features` is an ordinary array of labels.

The [runnable numeric baseline](../../demos/kaggle/002_prices.ra) currently
uses `OverallQual` and `GrLivArea`, fills missing values from the training
medians, fits log price with linear regression written in Rank, and writes the
`Id,SalePrice` submission. The neighboring tests do not require Kaggle files.

## Spaceship Titanic

Text splitting over a whole column:

```rank
Cabin = Train .Cabin pad "U/0/U"
Parts = Cabin "/" split

Train .Deck = Parts 0
Train .Number = Parts 1
Train .Side = Parts 2
```

The [runnable numeric baseline](../../demos/kaggle/003_spaceship.ra) fills the
five spending columns and age from training medians, derives total spending,
fits the Rank logistic regression, and writes boolean predictions. Its tests
use in-memory rows and cover missing test values.

## Digit Recognizer

Get all pixel columns except the target:

```rank
Features = Train labels
Mask = Features not equal .label
Features = (Features Mask) array

X = Train Features
Xtest = Test Features

X = X / 255
Xtest = Xtest / 255
```

A numeric table can participate directly in array arithmetic.

The [runnable Digit Recognizer baseline](../../demos/kaggle/004_digitsreq.ra)
reads train/test CSV files, gets pixel columns from `Train labels` in header
order, fits class centroids, and writes `ImageId,Label`. The train-derived class
set and column selection are covered by adjacent tests and a CLI file test.
Default local paths are `data/digits/{train,test}.csv` and
`submissions/digits.csv` under `demos/kaggle/`.

## Disaster Tweets

The workflow suggested reusable first-class preprocessing values:

```rank
Texts = Train .text pad ""
Vocab = Texts 128 vocab

Model = Texts Vocab tfidf_fit
X = Texts Model tfidf_transform
Xtest = (Test .text pad "") Model tfidf_transform
```

`words` and `vocab` are text-library words. The TF-IDF fitting and transform
remain [Rank functions](../../demos/kaggle/005_distweets.ra): the vocabulary
and inverse document frequencies come only from training text. The runnable
baseline fits Rank logistic regression and writes `id,target`. Its default
local paths are `data/disaster-tweets/{train,test}.csv` and
`submissions/disaster-tweets.csv` under `demos/kaggle/`.

## Store Sales

Grouping and join:

```rank
Keys =
  array .store_nbr .family .weekday

Groups = Train Keys group
Means = Groups .sales mean

Forecast = Test Keys Means join
```

The [runnable Store Sales baseline](../../demos/kaggle/006_storesales.ra)
implements the same grouping with an ordinary `index`: `(store, family,
weekday)` is a three-part key expanded by `unpack`. An unseen test key falls
back to the global training mean. The ISO-date weekday calculation and grouped
forecast both have focused tests.

## Bike Sharing

Date operations lift over columns:

```rank
Date = Train .datetime

Train .hour = Date hour
Train .weekday = Date weekday
Train .month = Date month
Train .year = Date year
```

Clamping without elementwise `max`:

```rank
Negative = Pred less 0
Pred Negative = 0
```

The [runnable Bike Sharing baseline](../../demos/kaggle/007_bakishare.ra)
parses the fixed Kaggle datetime format in Rank, combines four calendar and
eight numeric features, reuses the tested linear regression, clamps negative
predictions, and writes the required two-column submission.

## NYC Taxi

Apply a function to each row/cell:

```rank
Geo =
  Train .pickup_latitude
  .pickup_longitude
  .dropoff_latitude
  .dropoff_longitude

Train .distance =
  Geo distance rank 1
```

The [runnable NYC Taxi baseline](../../demos/kaggle/008_nytaxi.ra) builds the
five-feature matrix directly, computes a documented planar distance in Rank,
reuses the log-linear model, and writes `id,trip_duration`. Tests cover the
distance, datetime extraction and complete prediction path.

## Dogs vs Cats

Images should become ordinary tensor data:

```rank
Train = "demos/kaggle/data/dogs-vs-cats/train" images
Test = "demos/kaggle/data/dogs-vs-cats/test1" images
Pixels = Train 8 8 resize
X = Pixels (array (Train len) 192) reshape
```

The [runnable Dogs vs Cats baseline](../../demos/kaggle/009_dogvscat.ra)
derives cat/dog labels from training filenames, resizes JPEG/PNG files to
8×8 RGB, fits Rank logistic regression, and writes `id,label` probabilities.
The small image size keeps a full local competition run practical; this is a
simple pixel baseline, not a convolutional model. The CLI image test creates
real JPEG/PNG files and checks image order, decoding and the submission path.
Extract Kaggle's local archives into the two ignored directories shown above.

## Connect X

Ordinary two-dimensional addressing is sufficient:

```rank
Board r c
Next r c = Player
```

Game-specific primitives are unnecessary.

The [runnable example](../../demos/kaggle/010_connectx.ra) checks immediate
wins, blocks immediate losses and otherwise prefers a legal center column.
Its neighboring test file also verifies full columns, full boards and that
searching candidate moves does not mutate the input board.
