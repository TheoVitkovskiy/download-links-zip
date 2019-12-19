const express = require('express');
const async = require('async');
const https = require('https');
const fs = require('fs');
const archiver = require('archiver');
const nodemailer = require('nodemailer');
const sgTransport = require('nodemailer-sendgrid-transport');
const bodyParser = require('body-parser');
const cors = require('cors');
const authorizeGoogleDrive = require('./auth');

require('dotenv').config();

const app = express();

app.use(bodyParser.json());
app.use(cors());

app.post('/', async (req, res) => {
  const dir = './' + req.body.name;

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }

  download(req.body.links, dir);
  
  res.send('Your files will be downloaded shortly and sent to you per E-Mail.');
});

app.get('/email_callback', async (req, res) => {
  const link = req.query.link;
  
  setTimeout(() => deleteFile(link), 90 * 60 * 1000);

  res.redirect(link)
});

const deleteFile = async (link) => {
  const fileId = link.match(/d\/(.*)\/view/)[1];

  const promise = new Promise((resolve, reject) => {
    authorizeGoogleDrive((google, auth) => {
      const drive = google.drive({version: 'v3', auth});

      drive.files.delete({
        'fileId' : fileId,
      }, (err, file) => {
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

const download = (links, dir) => {
    async.forEachOf(links, (link, key, callback) => {
        const timeToSleepFor = randomIntFromInterval(3000, 30 * 60 * 1000);
        console.log('sleeping for: ' + timeToSleepFor);
        setTimeout(() => {
          const dest = dir + '/' + getLessonName(link);
          const file = fs.createWriteStream(dest);
          https.get(link, response => {
              response.pipe(file);
              file.on('finish', () => {
                file.close(() => {
                  console.log(dest);
                  callback();
                }); 
              }).on('close', (err) => {
  //                fs.unlink(dest, () => {
  //                  console.log('deleted file ' + dest);
  //                }); // Delete the file async. (But we don't check the result)
  //                if (err) cb(err.message);
              })
          });
          return '';
        }, timeToSleepFor);
    }, async () => {
      console.log('creating a zip ...');
      try {
        await zipDirectory(dir, dir + '.zip'); 
        console.log('uploading the zip to cloud ...');
        const link = await uploadZipToCloud(dir + '.zip');
        await sendLinkViaEmail(link);
      } catch (e) {
        console.log(e);
      } finally {
        cleanUp(dir);
      }
    });

}

const cleanUp = (dir) => {
  console.log('running clean up ...');
  fs.unlink(dir + '.zip', (err) => {
    console.error(err);
    return;
  })
}

const uploadZipToCloud = async (zip) => {
  console.log('ZIP', zip);
  const upload = new Promise((resolve, reject) => {
    authorizeGoogleDrive((google, auth) => {
      const drive = google.drive({version: 'v3', auth});

      const fileMetadata = {
        'name' : zip
      };

      const media = {
        //mimeType: 'image/jpeg',
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
          console.log('uploaded the zip to the cloud', file.data.webViewLink);
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

const sendLinkViaEmail = (link) => {
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

  console.log('Link to the ZIP file: ' + link);

  let transporter = nodemailer.createTransport(sgTransport({
    auth: {
      api_key: process.env.EMAIL_API_KEY
    }
  })); 

  const data = {
    from: 'thv_company@heroku.com',
    to: 'fvitkovski@mail.de',
    replyTo: 'theovitko@gmail.com',
    subject: link + ' Your zip is ready to download!',
    html: '<a href="https://zip-download.herokuapp.com/email_callback?link='+ link +'">Click to download your zip!</a>',
  }

  transporter.sendMail(data, (err, info) => {
    if (err) {
      console.error(err);
    } else {
      console.log(info);
    }

    console.log('email sent successfully');
  })
}

const getLessonName = (link) => {
  var parts = link.split('/');
  return parts[parts.length - 1];
}
 
/**
 * @param {String} source
 * @param {String} out
 * @returns {Promise}
 */
const zipDirectory = (source, out) => {
  const archive = archiver('zip', { zlib: { level: 9 }});
  const stream = fs.createWriteStream(out);

  return new Promise((resolve, reject) => {
    archive
      .directory(source, false)
      .on('error', err => reject(err))
      .pipe(stream)
    ;

    stream.on('close', () => resolve());
    archive.finalize();
  });
}


const port = process.env.PORT || 3004;
app.listen(port, () => {
  console.log(`The download link server is ready at port ${port}. Feel free to send some data in the form {"name" : "cool"}, "links" : ["https://link.com"]"} to POST /`)
});
