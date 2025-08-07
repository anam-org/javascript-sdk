const path = require('path');
const webpack = require('webpack');

module.exports = {
  entry: './src/index.ts',
  output: {
    path: path.resolve(__dirname, 'dist/umd'),
    filename: 'anam.js',
    library: {
      type: 'umd',
      name: 'anam',
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        loader: 'ts-loader',
        options: {
          transpileOnly: true,
        },
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js', '.json'],
    fallback: {
      buffer: require.resolve('buffer/'),
      fs: false,
      net: false,
      tls: false,
      http: false,
      https: false,
      stream: false,
      crypto: false,
      os: false,
      path: false,
      util: false,
    },
    alias: {
      // force ably to use the browser build
      ably$: path.join(__dirname, 'node_modules/ably/build/ably.js'),
    },
  },
  plugins: [
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
    }),
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify('production'),
      global: 'window',
    }),
    new webpack.IgnorePlugin({
      resourceRegExp: /^(got|ws|http|https|net|tls|fs)$/,
    }),
  ],
};
