
const authorizeGoogleDrive = require('./auth');

const deleteAllFiles = () => {
    authorizeGoogleDrive((google, auth) => {
      const drive = google.drive({version: 'v3', auth});

      drive.files.list({}, (err, {files}) => {
        if (err) {
          console.error(err);
          reject();
        } else {
          files.forEach(({id}) => {
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
        }
      })
    })
}

deleteAllFiles();