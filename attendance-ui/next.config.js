/**
 * Next.js configuration extended to proxy backend API & SSE streams
 * so the frontend can call relative paths without CORS hassles.
 */
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8080';

module.exports = {
	reactStrictMode: true,
	async rewrites() {
		return [
			{
				source: '/api/backend/:path*',
				destination: `${BACKEND_URL}/api/:path*`,
			},
			{
				source: '/api/attendance/stream',
				destination: `${BACKEND_URL}/api/attendance/stream`,
			},
			{
				source: '/api/employees/:path*',
				destination: `${BACKEND_URL}/api/employees/:path*`,
			},
			{
				source: '/api/organization/:path*',
				destination: `${BACKEND_URL}/api/organization/:path*`,
			},
		];
	},
};