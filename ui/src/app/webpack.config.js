'use strict;';

const path = require('path');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const {codecovWebpackPlugin} = require("@codecov/webpack-plugin");
const webpack = require('webpack');

const isProd = process.env.NODE_ENV === 'production';

// React Compiler is on by default; set REACT_COMPILER=0 for a no-compiler
// baseline build (used for A/B measurement). REACT_COMPILER_LOG=1 turns on the
// plugin's per-component compiled/bailed report (off in normal/CI builds).
const reactCompiler = process.env.REACT_COMPILER !== '0';
const reactCompilerLog = process.env.REACT_COMPILER_LOG === '1';

console.log(`Bundling in ${isProd ? 'production' : 'development'}...`);
console.log(`React Compiler: ${reactCompiler ? 'enabled' : 'disabled'}${reactCompiler && reactCompilerLog ? ' (logging)' : ''}`);

const esbuildTsxLoader = {
    loader: 'esbuild-loader',
    options: {
        loader: 'tsx',
        target: 'es2015',
        tsconfigRaw: require('./tsconfig.json')
    }
};

// When enabled, Babel handles the full .tsx transpile (TS + JSX) so the React
// Compiler analyzes source-equivalent input. esbuild can't be the first pass
// here: running the compiler on esbuild's type-stripped/JSX-lowered output
// produces spurious bailouts, so we drop esbuild for .tsx when the compiler is
// on and let Babel + esbuild's JS minify (later) split the work.
const tsxRule = reactCompiler
    ? {
          test: /\.tsx?$/,
          loader: 'babel-loader',
          options: {
              babelrc: false,
              configFile: false,
              // Strip types and transform JSX only; leave ES modules intact so
              // webpack resolves imports (preset-env's module transform changed
              // resolution and surfaced spurious missing-dep errors in argo-ui).
              // esbuild's existing /\.js$/ rule handles final JS lowering.
              presets: [
                  ['@babel/preset-react', {runtime: 'automatic'}],
                  ['@babel/preset-typescript', {isTSX: true, allExtensions: true}]
              ],
              plugins: [['babel-plugin-react-compiler', {target: '19', ...(reactCompilerLog ? {logger: {logEvent: (filename, event) => console.log(`[react-compiler] ${event.kind} ${filename ?? ''}`)}} : {})}]]
          }
      }
    : {
          test: /\.tsx?$/,
          ...esbuildTsxLoader
      };

const proxyConf = {
    target: process.env.ARGOCD_API_URL || 'http://localhost:8080',
    secure: false,
    // Rewrite Host header when proxying to a remote API server (e.g. a hosted Argo CD instance).
    changeOrigin: !!process.env.ARGOCD_API_URL
};

// Redirects argo-ui's `./logs-viewer/logs-viewer` import (and only that one) to
// a local stub, so xterm is not pulled into the entry bundle. Fails the build
// if it never matches, rather than silently regressing the bundle size.
let logsViewerShimHits = 0;
const logsViewerShim = new webpack.NormalModuleReplacementPlugin(/^\.\/logs-viewer\/logs-viewer$/, resource => {
    if (resource.context.endsWith(path.join('argo-ui', 'src', 'components'))) {
        logsViewerShimHits++;
        resource.request = path.resolve(__dirname, 'shims', 'logs-viewer.tsx');
    }
});

const assertLogsViewerShimApplied = {
    apply(compiler) {
        compiler.hooks.done.tap('AssertLogsViewerShimApplied', () => {
            if (logsViewerShimHits === 0) {
                throw new Error(
                    'logs-viewer shim never matched -- argo-ui may have moved the module. ' +
                    'xterm is likely back in the entry bundle; update the regex in webpack.config.js.'
                );
            }
        });
    }
};

const config = {
    entry: './src/app/index.tsx',
    output: {
        filename: '[name].[contenthash].js',
        chunkFilename: '[name].[contenthash].chunk.js',
        path: __dirname + '/../../dist/app',
        clean: true
    },
    cache: { type: 'filesystem' },
    optimization: {
        // Keep the webpack runtime in its own file so a route chunk change does
        // not invalidate vendors.
        runtimeChunk: 'single',
        splitChunks: {
            chunks: 'all',
            // Backstop against a long tail of tiny files: anything below this
            // is merged back into its parent rather than emitted separately.
            // Note this does not apply to explicit import() calls, which always
            // emit a chunk -- those are grouped by sharing webpackChunkName.
            minSize: 20000,
            maxAsyncRequests: 8,
            cacheGroups: {
                vendors: {
                    test: /[\\/]node_modules[\\/]/,
                    name: 'vendors',
                    chunks: 'initial',
                    priority: -5
                }
            }
        }
    },

    resolve: {
        extensions: ['.ts', '.tsx', '.js', '.json'],
        alias: {
            'react-form': require.resolve('argo-ui/src/components/form/compat.tsx'),
        },
        fallback: { fs: false }
    },
    ignoreWarnings: [{
        module: new RegExp('/node_modules/argo-ui/.*')
    }],
    module: {
        rules: [
            tsxRule,
            {
                enforce: 'pre',
                test: /\.js$/,
                exclude: [/node_modules\/react-paginate/, /node_modules\/monaco-editor/],
                use: ['source-map-loader'],
            },
            {
                enforce: 'pre',
                exclude: [/node_modules\/react-paginate/, /node_modules\/monaco-editor/],
                test: /\.js$/,
                use: ['esbuild-loader'],
            },
            {
                test: /\.scss$/,
                use: [
                    'style-loader',
                    {
                        loader: 'css-loader',
                        options: { url: false, import: false }
                    },
                    {
                        loader: 'sass-loader',
                        options: {
                            sassOptions: {
                                includePaths: ['node_modules'],
                                quietDeps: true,
                                silenceDeprecations: ['import', 'legacy-js-api', 'global-builtin', 'color-functions']
                            }
                        }
                    }
                ]
            },
            {
                test: /\.css$/,
                use: [
                    'style-loader',
                    {
                        loader: 'css-loader',
                        options: { url: false, import: false }
                    }
                ]
            }
        ]
    },
    plugins: [
        new webpack.DefinePlugin({
            'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
            'process.env.NODE_ONLINE_ENV': JSON.stringify(process.env.NODE_ONLINE_ENV || 'offline'),
            'process.platform': JSON.stringify('browser'),
            'SYSTEM_INFO': JSON.stringify({
                version: process.env.ARGO_VERSION || 'latest'
            })
        }),
        new HtmlWebpackPlugin({ template: 'src/app/index.html' }),
        // Break the argo-ui barrel -> LogsViewer -> xterm dependency chain; see
        // src/app/shims/logs-viewer.tsx. The counter guards against this
        // silently no-op'ing if argo-ui ever moves the file, which would put
        // xterm back into the entry bundle with no visible error.
        logsViewerShim,
        assertLogsViewerShimApplied,
        new webpack.IgnorePlugin({resourceRegExp: /^\.\/locale$/, contextRegExp: /moment$/}),
        new CopyWebpackPlugin({
            patterns: [{
                    from: 'src/assets',
                    to: 'assets'
                },
                {
                    from: 'node_modules/argo-ui/src/assets',
                    to: 'assets'
                },
                {
                    from: 'node_modules/@fortawesome/fontawesome-free/webfonts',
                    to: 'assets/fonts'
                },
                {
                    from: 'node_modules/redoc/bundles/redoc.standalone.js',
                    to: 'assets/scripts/redoc.standalone.js'
                },
                {
                    from: 'node_modules/monaco-editor/min/vs/base/browser/ui/codicons/codicon',
                    to: 'assets/fonts'
                }
            ]
        }),
        new MonacoWebpackPlugin({
            // https://github.com/microsoft/monaco-editor-webpack-plugin#options
            languages: ['yaml', 'json']
        }),
        codecovWebpackPlugin({
            enableBundleAnalysis: process.env.CODECOV_TOKEN !== undefined,
            bundleName: "argo-cd-ui",
            uploadToken: process.env.CODECOV_TOKEN,
        }),
    ],
    devServer: {
        compress: false,
        historyApiFallback: {
            disableDotRule: true
        },
        port: 4000,
        host: process.env.ARGOCD_E2E_JS_HOST || 'localhost',
        client: {
            overlay: {
                errors: true,
                warnings: false,
                // Filter out 401 unauthorized errors from overlay
                runtimeErrors: (error) => {
                    if (error.message && error.message.includes('Unauthorized')) {
                        return false;
                    }
                    if (error.message && error.message.includes('401')) {
                        return false;
                    }
                    return true;
                }
            }
        },
        proxy: [
            {
                context: ['/extensions', '/api', '/auth', '/swagger-ui', '/swagger.json', '/download'],
                ...proxyConf
            },
            {
                context: ['/terminal'],
                target: process.env.ARGOCD_API_URL || 'ws://localhost:8080',
                ws: true,
            }
        ]
    }
};

if (isProd) {
    config.performance = {
        hints: 'error',
        // Max size is 6MB before gzip.
        maxEntrypointSize: 6 * 1024 * 1024,
        maxAssetSize: 6 * 1024 * 1024,
    };
}

config.devtool = isProd ? 'source-map' : 'eval-source-map';

module.exports = config;
