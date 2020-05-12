const async = require('async');
const https = require('https');
const fs = require('fs');
const archiver = require('archiver');
const nodemailer = require('nodemailer');
const sgTransport = require('nodemailer-sendgrid-transport');
const authorizeGoogleDrive = require('./auth');
const ytdl = require('ytdl-core');
const throng = require('throng');
const Queue = require('bull');

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

const workers = process.env.WEB_CONCURRENCY || 1;

const maxJobsPerWorker = 1;

require('dotenv').config();

const originTypeEnum = {
  YOUTUBE: 'YouTube',
  DEFAULT: 'default'
}

const randomIntFromInterval = (min, max) => { // min and max included
  return Math.floor(Math.random() * (max - min + 1) + min);
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
      () => zipAndUpload(dir, recipientEmail)
    );
}

const downloadCourseFromLink = (link, key, callback, dir, format) => {
    const originType = getOriginType(link);

    ensureDirSync(dir);

    downloadCourseToFile(link, originType, createWriteStream(
      getDest(dir, link, format, originType),
      callback
    ));
}

function ensureDirSync (dirpath) {
  try {
    return fs.mkdirSync(dirpath)
  } catch (err) {
    if (err.code !== 'EEXIST') throw err
  }
}


const zipAndUpload = async (dir, recipientEmail) => {
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
    })
      .on('close', (err) => {
        fs.unlink(dest, () => {
          console.log('deleted file ' + dest);
        }); // Delete the file async. (But we don't check the result)
        if (err) cb(err.message);
      })
      .on('error', err => {
          console.log('The file was not piped/written correctly', err.message);
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
  var parts = link.split('/');
  return parts[parts.length - 1];
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

function start() {
    const downloadQueue = new Queue('download', REDIS_URL);

    downloadQueue.process(maxJobsPerWorker, async ({ data: { links, dir, recipientEmail, format } }) => {
      downloadCourse(links, dir, recipientEmail, format);
    });
}

throng({ workers, start });
