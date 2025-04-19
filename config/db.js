const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgres://postgres:Kapbytes18@pw4g4cgo40sgs80scw0w0ss4:5432/postgres',
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};
