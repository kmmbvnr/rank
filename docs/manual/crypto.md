# crypto manual

## md5

### NAME

MD5 digest of bytes or UTF-8 text, as 16
bytes.

### SYNOPSIS

```text
Value md5 -> bytes
Value: text or bytes
```

### DESCRIPTION

Text is encoded as UTF-8; bytes can be
hashed directly. MD5 is a legacy
checksum and is unsuitable for password
storage or security-sensitive integrity
checks. Begin the program with use
crypto.

### EXAMPLES

Hash text, then show its 16 bytes as
hex.

```rank
use crypto
use text
"Rank" md5 hex
```
