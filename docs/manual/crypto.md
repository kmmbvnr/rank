# crypto manual

## md5

The MD5 fingerprint of text or bytes.

```rank
use crypto
use text
"Rank" md5 hex
```

```result
021da1b20f73dc252361a54d80497ef3
```

### Usage

```text
Value md5
```

Gives 16 bytes; hex turns them into
readable text. Text is encoded as UTF-8
first.

### Notes

MD5 is fine for checksums and puzzles,
but it is broken for security: never use
it for passwords.

### See also

hex, bytes
