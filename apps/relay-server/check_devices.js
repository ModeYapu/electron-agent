require('dotenv/config');
const jwt = require('jsonwebtoken');
const http = require('http');

const token = jwt.sign({username:'admin',role:'admin'}, process.env.JWT_SECRET, {expiresIn:'1h'});

const req = http.get('http://localhost:9300/api/devices', {
    headers: { 'Authorization': 'Bearer ' + token }
}, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        console.log('Status:', res.statusCode);
        console.log('Body:', data);
    });
});
req.on('error', e => console.error('Error:', e.message));
