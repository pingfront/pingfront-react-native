const path = require('path');
const pkg = require('../package.json');

// Autolink the library from the parent folder, as if it were installed from npm.
module.exports = {
  dependencies: {
    [pkg.name]: {
      root: path.join(__dirname, '..'),
      platforms: {
        ios: {},
        android: {},
      },
    },
  },
};
