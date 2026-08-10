const fs = require('fs');
const { minify } = require('terser');
const JavaScriptObfuscator = require('javascript-obfuscator');

async function build() {
  const source = fs.readFileSync('app.js', 'utf8');

  const minified = await minify(source, { compress: true, mangle: true });

  const obfuscated = JavaScriptObfuscator.obfuscate(minified.code, {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.75,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.4,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 0.75,
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,
    selfDefending: false
  });

  fs.writeFileSync('app.min.js', obfuscated.getObfuscatedCode());
  console.log('Build complete: app.min.js written.');
}

build().catch(err => {
  console.error(err);
  process.exit(1);
});
