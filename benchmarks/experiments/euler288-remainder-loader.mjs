// Research only: replace nonnegative Number remainders below 2^52 by division.
// A quotient rounding error is < 1/(2*b), less than the distance to the next
// integer for a nonintegral a/b. The integer product floor(a/b)*b is <= a,
// so the multiplication and subtraction are exact too. All other cases retain %.
// Existing zero, sign-correction and safe-integer checks remain in generated code.
const NativeFunction = globalThis.Function;
let replacements = 0;
globalThis.Function = function (...args) {
    if (args[0] === 'safe') {
        args[args.length - 1] = String(args.at(-1)).replace(
            /const (m\d+) = \(([^\n;]+)\) % \(([^\n;]+)\);/g,
            (_, name, a, b) => {
                replacements++;
                return `const ${name} = typeof (${a}) === 'number' && (${a}) >= 0 && (${a}) < 4503599627370496 && (${b}) > 0 ? (${a}) - Math.floor((${a}) / (${b})) * (${b}) : (${a}) % (${b});`;
            });
    }
    return NativeFunction(...args);
};
process.on('exit', code => {
    if (!code && !replacements) {
        console.error('Research remainder loader did not match a numeric loop');
        process.exitCode = 1;
    }
});
