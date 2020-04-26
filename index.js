const express = require('express');
const fs = require('fs');
const bodyParser = require('body-parser');
const cors = require('cors');
const Queue = require('bull');

require('dotenv').config();

const app = express();

app.use(bodyParser.json());
app.use(cors());

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const downloadQueue = new Queue('download', REDIS_URL);

app.post('/', async ({
  body: {
    links,
    recipientEmail,
    format = 'mp4',
    name = 'your_zipped_files'
  }
}, res) => {
  let errors = [];

  if (!links) {
    errors.push({
      field: 'links',
      message: 'Please provide an array of links to download.'
    });
  }
  if (!recipientEmail) {
    errors.push({
      field: 'recipientEmail',
      message: 'Please provide the email to send the zip to.'
    });
  }
  if (recipientEmail && !validateEmail(recipientEmail)) {
    errors.push({
      field: 'recipientEmail',
      message: 'Please provide a valid email to send the zip to.'
    });
  }

  if (errors.length > 0) {
    res.status(400).send({ errors });
    return;
  }

  const dir = './' + name;

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }

  await downloadQueue.add({
    links,
    dir,
    recipientEmail,
    format
  });

  const message = `Your files will be downloaded within the next ${links.length / 4} minutes and sent to you per E-Mail.`;
  res.send({'message' : message});
});

app.get('/email_callback', async (req, res) => {
  const link = req.query.link;

//  setTimeout(() => deleteFile(link, pingHeroku()), 90 * 60 * 1000);

  res.redirect(link)
});

const validateEmail = (email) => {
    const re = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(String(email).toLowerCase());
}

const port = process.env.PORT || 3004;

app.listen(port, () => {
  console.log(`The download link server is ready at port ${port}. Feel free to send some data in the form {"name" : "cool"}, "links" : ["https://link.com"]"} to POST /`)
});
