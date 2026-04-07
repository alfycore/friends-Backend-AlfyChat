import mysql from 'mysql2/promise';
import winston from 'winston';
declare const app: import("express-serve-static-core").Express;
declare const logger: winston.Logger;
export declare function getDatabase(): mysql.Pool;
export { app, logger };
//# sourceMappingURL=index.d.ts.map