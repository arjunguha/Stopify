module.exports = {
  entry: './dist/src/runtime/runtime.js',
  output: {
    filename: 'dist/stopify-continuations.bundle.js',
    library: 'stopifyCont',
    libraryTarget: 'var'
  },
  node: {
    // Commander has these as dependencies
    'fs': 'empty',
    'child_process': 'empty',
  }
};
