
import { parse as parseUrl } from 'url';
import { parse as parseQueryString } from 'querystring';
import { MiddlewareInput, Request, Response } from '@celeri/http-server';
import { Socket } from 'net';

const nanosecondsPerMillisecond = 10e5;
const oneMinute = 60;
const oneHour = 60 * 60;

const standardTokens = [ 'status-code', 'duration', 'proto', 'method', 'path', 'iso-time' ];

interface CustomTokens {
	[token: string]: RequestLoggerFormatter
}

export interface RequestLoggerConfig {
	log: (message: string, req: Request, res: Response, duration: string, finished: boolean) => void,
	format?: string | RequestLoggerFormatter,
	customTokens?: CustomTokens
}

export interface RequestLoggerFormatter {
	/**
	 * Formats the message to be logged
	 *
	 * @param req The HTTP request object
	 * @param res The HTTP response object
	 * @param duration The run duration of the request as a formatted string
	 * @param finished Did the request finish (true) or was the connection closed prematurely (false)
	 */
	(req: Request, res: Response, duration: string, finished: boolean): string;
}

export const requestLogger = (config: RequestLoggerConfig) => {
	const format = typeof config.format === 'string'
		? compileTemplate(config.format, config.customTokens)
		: config.format;

	return ({ req, res }: MiddlewareInput<void, void>): void => {
		const startTime = process.hrtime();

		const logRequest = (finished: boolean) => {
			const duration = formatDuration(process.hrtime(startTime));
			const message = format ? format(req, res, duration, finished) : null;

			res.removeListener('finish', onFinish);
			res.removeListener('close', onClose);

			config.log(message, req, res, duration, finished);
		};

		const onFinish = () => logRequest(true);
		const onClose = () => logRequest(false);
		
		res.on('finish', onFinish);
		res.on('close', onClose);
	};
};

export const compileTemplate = (template: string, customTokens?: CustomTokens) : RequestLoggerFormatter => {
	const tokens = standardTokens.slice();

	if (customTokens) {
		tokens.push(...Object.keys(customTokens));
	}

	const tokensRegex = new RegExp(`(:(${tokens.join('|')}))`, 'g');
	const initialSplit = template.split(tokensRegex);
	const templateChunks = [ ];
	const tokenList: string[] = [ ];

	for (let i = 0; i < initialSplit.length; i++) {
		templateChunks.push(initialSplit[i++]);

		if (initialSplit[++i]) {
			tokenList.push(initialSplit[i]);
		}
	}

	return (req: Request, res: Response, duration: string, finished: boolean) : string => {
		const chunks = [ ];

		for (let i = 0; i < templateChunks.length; i++) {
			chunks.push(templateChunks[i]);

			const token = tokenList[i];

			if (! token) {
				continue;
			}

			switch (token) {
				case 'iso-time':
					chunks.push((new Date()).toISOString());
					break;

				case 'status-code':
					chunks.push(res.statusCode);
					break;

				case 'duration':
					chunks.push(duration);
					break;

				case 'proto':
					chunks.push((req.connection as any).encrypted ? 'https' : 'http');
					break;

				case 'method':
					chunks.push(req.method);
					break;

				case 'path':
					chunks.push(req.pathname);
					break;

				default:
					chunks.push(customTokens[token](req, res, duration, finished));
					break;
			}
		}

		return chunks.join('');
	};
};

/**
 * Returns a formatted duration string from a `process.hrtime()` result. Output can look like
 * "4.56789ms", "3sec4.56789ms", "2min3sec4.56789ms", or "1hr2min3sec4.56789ms"
 */
export const formatDuration = ([ wholeSeconds, nanoseconds ]: [ number, number ]) : string => {
	const milliseconds = `${(nanoseconds / nanosecondsPerMillisecond).toPrecision(6)}ms`;

	if (wholeSeconds < 1) {
		return milliseconds;
	}

	if (wholeSeconds < oneMinute) {
		return `${wholeSeconds}sec ${milliseconds}`;
	}

	if (wholeSeconds < oneHour) {
		const minutes = Math.floor(wholeSeconds / oneMinute);
		const remainingSeconds = wholeSeconds % oneMinute;

		return `${minutes}min${remainingSeconds}sec${milliseconds}`;
	}

	const hours = Math.floor(wholeSeconds / oneHour);
	const remainingMinutes = Math.floor(wholeSeconds % oneHour / oneMinute);
	const remainingSeconds = Math.floor(wholeSeconds % oneHour % oneMinute);

	return `${hours}hr${remainingMinutes}min${remainingSeconds}sec${milliseconds}`;
};
