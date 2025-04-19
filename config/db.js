const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgres://postgres:bXAXZMD2jwAxPr6g2QYZEuZQuJ8KjQiSS8TnUih7OgOvLqtAJU4Yoeajx09N3iVb@og0s440coccoow0884c084oc:5432/postgres',
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};
