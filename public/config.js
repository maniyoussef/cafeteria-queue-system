/**
 * CampusBite — Server connection config
 *
 * The website talks to the VM1 queue server at SERVER_URL for all REST calls
 * and the Socket.IO real-time channel. Override without editing this file by
 * opening the page with ?server=http://<ip>:<port>
 */
(function () {
  var DEFAULT_SERVER_URL = 'http://10.102.148.12:8080';

  var override = new URLSearchParams(window.location.search).get('server');
  window.SERVER_URL = (override || DEFAULT_SERVER_URL).replace(/\/+$/, '');

  // Load the Socket.IO client from the server itself so versions always match
  document.write('<script src="' + window.SERVER_URL + '/socket.io/socket.io.js"><\/script>');
})();
