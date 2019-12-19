const fs = require('fs');
const readline = require('readline');
const {google} = require('googleapis');

// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

module.exports = (callback) => {
  authorize(callback);
}

function authorize(callback) {
  console.log(process.env.PRIVATE_KEY);
  const jwt = new google.auth.JWT(
    process.env.CLIENT_EMAIL,
    null,
    process.env.PRIVATE_KEY,
    SCOPES
  );

  jwt.authorize((err, response) => {
    callback(google, jwt);
  })

}

