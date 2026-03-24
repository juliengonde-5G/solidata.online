const { createLogger, format, transports } = require('winston');
const path = require('path');

const isProduction = process.env.NODE_ENV === 'production';

const logger = createLogger({
  level: isProduction ? 'info' : 'debug',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    isProduction
      ? format.json()
      : format.combine(format.colorize(), format.printf(({ timestamp, level, message, stack, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
          return `${timestamp} ${level}: ${message}${stack ? '\n' + stack : ''}${metaStr}`;
        }))
  ),
  defaultMeta: { service: 'solidata-api' },
  transports: [
    new transports.Console(),
    ...(isProduction ? [
      new transports.File({ filename: path.join(__dirname, '..', '..', 'logs', 'error.log'), level: 'error', maxsize: 5 * 1024 * 1024, maxFiles: 5 }),
      new transports.File({ filename: path.join(__dirname, '..', '..', 'logs', 'combined.log'), maxsize: 10 * 1024 * 1024, maxFiles: 5 }),
    ] : []),
  ],
});

module.exports = logger;
