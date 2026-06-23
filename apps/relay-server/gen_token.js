require('dotenv/config');
const jwt = require('jsonwebtoken');
const t = jwt.sign({username:'admin',role:'admin'}, process.env.JWT_SECRET, {expiresIn:'1h'});
console.log(t);
