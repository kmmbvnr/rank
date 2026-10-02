# images manual

## images

### NAME

Table of the JPEG and PNG files in a
directory, with name and path.

### SYNOPSIS

```text
Directory images -> table
Directory: text path
```

### DESCRIPTION

Requires a host that can access and
decode images, and an existing photos
directory. Returns a table of image
names and paths; it does not download
images. Begin the program with use
images.

### EXAMPLES

List image files from the photos
directory.

```rank
use images
"photos" images
```

## resize

### NAME

Decodes every image and stretches it
into a lazy RGB tensor.

### SYNOPSIS

```text
Images Height Width resize -> array
Images: image table; Height, Width:
integers
```

### DESCRIPTION

Requires an existing image directory and
host image decoding. Height and Width
are positive integers. The result axes
are image, height, width, channel; RGB
has three channels. Values are produced
on demand; storing the result does not
force every item. Begin the program with
use images.

### EXAMPLES

Decode images into 32-by-32 RGB tensors.

```rank
use images
Rows = "photos" images
Rows 32 32 resize
```
