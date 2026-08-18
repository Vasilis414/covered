/**
 * Xcode 26.2+ compiles ExpoModulesJSI with C++ interop, which makes
 * `abs(Double)` ambiguous between Swift.abs and the C++ stdlib overloads.
 * Expo's 57.0.4 still ships the unqualified call. Drop this script when a
 * newer expo-modules-jsi includes Swift.abs.
 */
const fs = require('fs');
const path = require('path');

const file = path.join(
  __dirname,
  '..',
  'node_modules/expo-modules-jsi/apple/Sources/ExpoModulesJSI/Coding/JavaScriptCodable+Date.swift',
);

if (!fs.existsSync(file)) process.exit(0);

const source = fs.readFileSync(file, 'utf8');
if (source.includes('Swift.abs(milliseconds)')) process.exit(0);

const next = source.replace(
  'abs(milliseconds) <= maxJavaScriptDateMilliseconds',
  'Swift.abs(milliseconds) <= maxJavaScriptDateMilliseconds',
);

if (next === source) {
  console.warn('patch-expo-modules-jsi: expected abs() call not found — check expo-modules-jsi');
  process.exit(0);
}

fs.writeFileSync(file, next);
console.log('patched expo-modules-jsi Date.abs for Xcode 26');
