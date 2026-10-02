# images manual

## images

List the photos in a folder.

```rank
use images
use tables
T = "photos" images
T .name
```

```result
one.png
```

### Usage

```text
Folder images
```

Gives a table with a .name and a .path
for each JPEG and PNG file.

### Notes

The folder must exist and the app must
be allowed to read it.

### See also

resize, table

## resize

Load images and scale them all to the
same size, ready for computing.

```rank
use images
use sequences
Rows = "photos" images
P = Rows 32 32 resize
P shape
```

```result
1 32 32 3
```

### Usage

```text
Images Height Width resize
```

Images is the table from images. The
result has four axes: image, row, column
and colour, with three colour values
(red, green, blue) per pixel. Images are
stretched to fit, not cropped.

### See also

images, shape
