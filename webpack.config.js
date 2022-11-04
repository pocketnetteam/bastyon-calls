// webpack.config.js
const path = require('path')
const { CleanWebpackPlugin } = require('clean-webpack-plugin')
module.exports = {
	mode: 'production',
	entry: {
		bastyonCalls: path.resolve(__dirname, './src/Calls.js'),
	},
	output: {
		path: path.resolve(__dirname, './dist'),
		filename: '[name].min.js',
		library: 'libraryStarter',
		libraryTarget: 'umd',
		globalObject: 'this',
	},
	module: {
		rules: [
			// JavaScript
			{
				test: /\.js$/,
				exclude: /node_modules/,
				use: ['babel-loader'],
			},
			{
				//SCSS
				test: /\.s[ac]ss$/i,
				use: [
					// Creates `style` nodes from JS strings
					"style-loader",
					// Translates CSS into CommonJS
					"css-loader",
					// Compiles Sass to CSS
					"sass-loader",
				],
			},
		],
	},
	plugins: [
		new CleanWebpackPlugin(),
	],
}