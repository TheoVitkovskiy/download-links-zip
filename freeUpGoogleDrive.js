
const authorizeGoogleDrive = require('./auth');

const deleteAllFiles = () => {
    authorizeGoogleDrive((google, auth) => {
      const drive = google.drive({version: 'v3', auth});

      drive.files.list((err, {data}) => {
        if (err) {
          console.error(err);
          reject();
        } else {
          data.files.forEach(({id}) => {
            drive.files.delete({
              'fileId' : id,
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