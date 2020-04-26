
const authorizeGoogleDrive = require('./auth');

const deleteAllFiles = () => {
    authorizeGoogleDrive((google, auth) => {
      const drive = google.drive({version: 'v3', auth});
      var yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      drive.files.list({
        q: `modifiedTime < '${yesterday}'` 
      }, (err, {data}) => {
        if (err) {
          console.error(err);
        } else {
          data.files.forEach(({id}) => {
            drive.files.delete({
              'fileId' : id,
            }, (err, file) => {
              if (err) {
                console.error(err);
              } else {
                console.log('successfully deleted the file with the id: ', id);
              }
            })
          })
        }
      })
    })
}

deleteAllFiles();
