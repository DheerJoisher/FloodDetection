import 'server-only';

import mysql, { type Pool } from 'mysql2/promise';

import './env';

type MysqlGlobal = typeof globalThis & { godavariMysqlPool?: Pool };

const globalForMysql = globalThis as MysqlGlobal;

export const pool =
  globalForMysql.godavariMysqlPool ??
  mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'flood_management',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    dateStrings: ['DATE'],
    decimalNumbers: true,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForMysql.godavariMysqlPool = pool;
}
