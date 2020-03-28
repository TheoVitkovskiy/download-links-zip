require('newrelic');
const express = require('express');
const async = require('async');
const https = require('https');
const http = require('http');
const fs = require('fs');
const archiver = require('archiver');
const nodemailer = require('nodemailer');
const sgTransport = require('nodemailer-sendgrid-transport');
const bodyParser = require('body-parser');
const cors = require('cors');
const authorizeGoogleDrive = require('./auth');
const ytdl = require('ytdl-core');

require('dotenv').config();

const app = express();

app.use(bodyParser.json());
app.use(cors());

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

  downloadCourse(links, dir, recipientEmail, format);

  const message = `Your files will be downloaded within the next ${links.length / 4} minutes and sent to you per E-Mail.`;
  res.send({'message' : message});
});

app.get('/email_callback', async (req, res) => {
  const link = req.query.link;

  setTimeout(() => deleteFile(link, pingHeroku()), 90 * 60 * 1000);

  res.redirect(link)
});

const validateEmail = (email) => {
    const re = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(String(email).toLowerCase());
}

const originTypeEnum = {
  YOUTUBE: 'YouTube',
  DEFAULT: 'default'
}

const deleteFile = async (link,pingHeroku) => {
  const fileId = link.match(/d\/(.*)\/view/)[1];

  const promise = new Promise((resolve, reject) => {
    authorizeGoogleDrive((google, auth) => {
      const drive = google.drive({version: 'v3', auth});

      drive.files.delete({
        'fileId' : fileId,
      }, (err, file) => {
        clearInterval(pingHeroku);
        if (err) {
          console.error(err);
          reject();
        } else {
          console.log('successfully deleted the file with the id: ', fileId);
        }
      })
    })
  })

  await promise;
}

const randomIntFromInterval = (min, max) => { // min and max included
  return Math.floor(Math.random() * (max - min + 1) + min);
}

const pingHeroku = () => {
    return setInterval(() => {
      https.get(process.env.HOST_URL, (response) => {
        console.log('heroku was successfully pinged');
      });
    }, 300000);
}

const downloadCourse = (links, dir, recipientEmail, format) => {
    async.forEachOf(
      links,
      (link, key, callback) => {
        const timeToSleepFor = randomIntFromInterval(3000, (links.length * 60 * 1000) / 4);

        setTimeout(() => {
          downloadCourseFromLink(link, key, callback, dir, format)
        }, timeToSleepFor);
      },
      () => zipAndUpload(dir, pingHeroku(), recipientEmail)
    );
}

const downloadCourseFromLink = (link, key, callback, dir, format) => {
    const originType = getOriginType(link);

    downloadCourseToFile(link, originType, createWriteStream(
      getDest(dir, link, format, originType),
      callback
    ));
}


const zipAndUpload = async (dir, pingHeroku, recipientEmail) => {
  try {
    const zip = await zipDirectory(dir);
      console.log('created the zip, now uploading the zip to the cloud ...');
    const link = await uploadZipToCloud(zip);
      console.log('uploaded the zip to the cloud, now send the link to the zip via email ...')
    await sendLinkViaEmail(link, dir, recipientEmail);
      console.log(`sent the link: ${link} to the email: ${recipientEmail}`)
  } catch (e) {
      console.error('something went wrong during the zipAndUpload process', e);
  } finally {
      console.log('finished creating, uploading and sending the zip, cleaning up ...')
    cleanUp(dir);
    clearInterval(pingHeroku);
  }
}

const downloadCourseToFile = (link, originType, writeStream) => {
    switch(originType) {
      case originTypeEnum.YOUTUBE:
        ytdl(link, { 
          quality: 'lowestaudio',
          filter: 'audioonly'
        })
          .pipe(writeStream)
        break;
      default:
        https.get(link, response => {
          response.pipe(writeStream);
        });
    }
}

const createWriteStream = (dest, callback) => {
    const file = fs.createWriteStream(dest);

    file.on('finish', () => {
      file.close(() => {
        console.log(dest);
        callback();
      });
    }).on('close', (err) => {
//        fs.unlink(dest, () => {
//          console.log('deleted file ' + dest);
//        }); // Delete the file async. (But we don't check the result)
//        if (err) cb(err.message);
    })

  return file;
}

const getOriginType = (link) => {
  if (link.includes('www.youtube.com/watch?v')) {
    return originTypeEnum.YOUTUBE;
  } else {
    return originTypeEnum.DEFAULT;
  }
}

const cleanUp = (dir) => {
  fs.unlink(dir + '.zip', (err) => {
    console.error(err);
    return;
  })
}

const uploadZipToCloud = async (zip) => {
  const upload = new Promise((resolve, reject) => {
    authorizeGoogleDrive((google, auth) => {
      const drive = google.drive({version: 'v3', auth});

      const fileMetadata = {
        'name' : zip
      };

      const media = {
        body: fs.createReadStream(zip)
      }

      drive.files.create({
        resource: fileMetadata,
        media,
        fields: 'webViewLink,id'
      }, (err, file) => {
        if (err) {
          console.error(err);
          reject();
        } else {
          drive.permissions.create({
            fileId: file.data.id,
            resource: {
              role: "reader",
              type: "anyone"
            }
          }, (err, result) => {
              console.log('gave permissions to read for everyone');
              if(err) console.log(err)
              else resolve([ file.data.webViewLink ]);
            });
        }
      })

    })
  })

  const [ link ] = await upload;

  return link;
}

const sendLinkViaEmail = (link, dir, email) => {
  const transport = {
    service: 'gmail',
    secure: false,
    port: 25,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    },
    tls: {
      rejectUnauthorized: false
    }
  }
  console.log(JSON.parse(JSON.stringify(transport)));

  let transporter = nodemailer.createTransport(sgTransport({
    auth: {
      api_key: process.env.EMAIL_API_KEY
    }
  }));

  const data = {
    from: 'thv_company@heroku.com',
    to: email,
    replyTo: email,
    subject: dir + ' Your zip is ready to download!',
    html: '<a href="https://zip-download.herokuapp.com/email_callback?link='+ link +'">Click to download your zip!</a>',
  }

  transporter.sendMail(data, (err, info) => {
    if (err) {
      console.error(err);
    } else {
      console.log(info);
    }
  })
}

const getDest = (dir, link, format, originType) => (
  dir + '/' + getUniqueName(link, originType) + getEnding(format, link)
)

const getEnding = (format, link) => {
  const supportedFormats = [
    'mp3',
    'mp4'
  ];

  supportedFormats.forEach(format => {
    if (link.includes(format)) {
      return '';
    }
  });

  let ending = supportedFormats.includes(format) ? '.' + format : '';

  return ending;
}

const getUniqueName = (link, originType) => {
  switch(originType) {
    case originTypeEnum.YOUTUBE:
      var parts = link.split('/');
      return parts[parts.length - 1];
    default:
      return link;
  }
}

const zipDirectory = (source) => {
  const out = source + '.zip';
  const archive = archiver('zip', { zlib: { level: 9 }});
  const stream = fs.createWriteStream(out);

  return new Promise((resolve, reject) => {
    archive
      .directory(source, false)
      .on('error', err => reject(err))
      .pipe(stream);

    stream.on('close', () => resolve(out));
    archive.finalize();
  });
}

const port = process.env.PORT || 3004;

app.listen(port, () => {
  console.log(`The download link server is ready at port ${port}. Feel free to send some data in the form {"name" : "cool"}, "links" : ["https://link.com"]"} to POST /`)
});
