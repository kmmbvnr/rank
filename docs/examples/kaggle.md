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

Data = csv "train.csv"

Keys = .Sex .Pclass
Groups = Data Keys group
Rate = Groups .Survived mean

print Rate
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
    .Female .Pclass .Age .Fare

X = Train Features
Xtest = Test Features
```

## House Prices

Reusable feature selectors:

```rank
rem Kaggle: House Prices
rem Predict SalePrice.

Features =
    .OverallQual .GrLivArea
    .Neighborhood .HouseStyle
    .KitchenQual .ExterQual

X = Train Features
Xtest = Test Features
```

`Features` is just a sequence of labels.

## Spaceship Titanic

Text splitting over a whole column:

```rank
Cabin = Train .Cabin pad "U/0/U"
Parts = Cabin "/" split

Train .Deck = Parts 0
Train .Number = Parts 1
Train .Side = Parts 2
```

## Digit Recognizer

Get all pixel columns except the target:

```rank
Features = Train labels
Mask = Features not equal .label
Features = Features Mask

X = Train Features
Xtest = Test Features

X = X / 255
Xtest = Xtest / 255
```

A numeric table can participate directly in array arithmetic.

## Disaster Tweets

The workflow suggested reusable first-class preprocessing values:

```rank
Texts = Train .text
Vocab = Texts vocab

X = Train .text Vocab tfidf
Xtest = Test .text Vocab tfidf
```

Whether `vocab` and `tfidf` belong as library words remains open.

## Store Sales

Grouping and join:

```rank
Keys =
    .store_nbr .family .weekday

Groups = Train Keys group
Means = Groups .sales mean

Forecast = Test Keys Means join
```

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

## Dogs vs Cats

Images should become ordinary tensor data:

```rank
X = Train .image
Xtest = Test .image

X = X 128 128 resize
Xtest = Xtest 128 128 resize

X = X / 255
Xtest = Xtest / 255
```

## Connect X

Ordinary two-dimensional addressing is sufficient:

```rank
Board r c
Next r c = Player
```

Game-specific primitives are unnecessary.
