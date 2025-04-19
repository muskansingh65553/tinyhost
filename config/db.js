const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: '4.255.241.23',
    database: 'postgres',
    password: 'Kapbytes18',
    port: 5432,
});

module.exports = {
    query: (text, params) => pool.query(text, params),
}; 
