const { Web3Storage, File } = require("web3.storage");

const API_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkaWQ6ZXRocjoweDA5NDg2MjA3NDAxMjJDOTFkZWNlNzUwRDFEMDhFM0ZFOEUwMDQ1MDEiLCJpc3MiOiJ3ZWIzLXN0b3JhZ2UiLCJpYXQiOjE2NjEyODExMjU4MTEsIm5hbWUiOiJ3ZWIzLXRlc3QifQ.Ja5fln0-MAU2H4dmNuq2i3RQ-VXzKpl9RH-By2bcvkw";

const uploadImage = async () => {
  const client = new Web3Storage({ token: API_KEY });
};
