const fetch = require("node-fetch");
const AWS = require("aws-sdk");
const busboy = require("busboy");
const getRawBody = require("raw-body");

const { Web3Storage, File } = require("web3.storage");

const API_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkaWQ6ZXRocjoweDA5NDg2MjA3NDAxMjJDOTFkZWNlNzUwRDFEMDhFM0ZFOEUwMDQ1MDEiLCJpc3MiOiJ3ZWIzLXN0b3JhZ2UiLCJpYXQiOjE2NjEyODExMjU4MTEsIm5hbWUiOiJ3ZWIzLXRlc3QifQ.Ja5fln0-MAU2H4dmNuq2i3RQ-VXzKpl9RH-By2bcvkw";

const makeStorageClient = () => {
  return new Web3Storage({ token: API_KEY });
};

const docClient = new AWS.DynamoDB.DocumentClient();

// Get the DynamoDB table name from environment variables
const tableName = process.env.DAG_TOKEN_TABLE;

// const tableName = "dag-token-DagTokenTable-FWCC3828NWJL";

const HEADERS = {
  "Access-Control-Allow-Headers":
    "Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token,Origin",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "OPTIONS,POST,DELETE,PUT,GET",
};

const parseForm = (body, headers) =>
  new Promise((resolve, reject) => {
    const contentType = headers["Content-Type"] || headers["content-type"];
    const bb = busboy({ headers: { "content-type": contentType } });

    const filePromises = [];
    const data = {};
    bb.on("file", function (name, file, filename, encoding, mimetype) {
      data[name] = {
        filename,
        encoding,
        mimetype,
      };
      filePromises.push(
        getRawBody(file).then((rawFile) => (data[name].content = rawFile))
      );
    })
      .on("field", (fieldname, val) => {
        data[fieldname] = val;
      })
      .on("finish", () => {
        resolve(Promise.all(filePromises).then(() => data));
      })
      .on("error", (err) => {
        reject(err);
      });

    bb.end(body);
  });

exports.auxiliaryHandler = async (event) => {
  const method = event.httpMethod;

  if (method == "OPTIONS") {
    return {
      statusCode: 200,
      headers: HEADERS,
    };
  }

  let response = {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({ message: "default!" }),
  };

  // All log statements are written to CloudWatch
  console.info("[Auxiliary] Event:", JSON.stringify(event));

  if (method == "GET") {
    const params = event?.queryStringParameters;
    if (!params || (!params?.id && !params.endpoint)) {
      response = {
        statusCode: 400,
        headers: HEADERS,
        body: JSON.stringify({ message: "Query param missing!" }),
      };
    }

    if (params?.id) {
      try {
        const getParams = {
          TableName: tableName,
          Key: { id: params.id },
        };
        console.info("getParams", JSON.stringify(getParams));
        const data = await docClient.get(getParams).promise();
        console.info("data", JSON.stringify(data));
        const item = data.Item;

        response = {
          statusCode: 200,
          headers: HEADERS,
          body: JSON.stringify(item),
        };
      } catch (ResourceNotFoundException) {
        response = {
          statusCode: 404,
          headers: HEADERS,
          body: "Unable to call DynamoDB. Table resource not found.",
        };
      }
    } else if (params?.endpoint) {
      try {
        const res = await fetch(params.endpoint);
        const data = await res.json();
        response = {
          statusCode: 200,
          headers: HEADERS,
          body: JSON.stringify(data),
        };
      } catch (err) {
        response = {
          statusCode: 400,
          headers: HEADERS,
          body: err.message,
        };
      }
    } else {
      response = {
        statusCode: 400,
        headers: HEADERS,
        body: "Params not supported!",
      };
    }
  } else if (method == "POST") {
    const contentType = event.headers["Content-Type"];
    if (contentType.startsWith("multipart/form-data")) {
      const client = makeStorageClient();
      // const boundary = contentType.split("boundary=")[1];
      const decoded = Buffer.from(event?.body, "base64").toString("utf8");
      const data = await parseForm(decoded, event.headers);
      const files = [
        new File(data.image.content.data, data.image.filename.filename),
      ];
      const cid = await client.put(files);
      console.log("stored files with cid:", cid);
    } else {
      const body = parseEvent(event);
      try {
        const params = {
          TableName: tableName,
          Item: { id: body?.id, uri: body?.uri },
        };

        const result = await docClient.put(params).promise();

        response = {
          statusCode: 200,
          headers: HEADERS,
          body: JSON.stringify(body),
        };
      } catch (ResourceNotFoundException) {
        response = {
          statusCode: 404,
          headers: HEADERS,
          body: "Unable to call DynamoDB. Table resource not found.",
        };
      }
    }
  } else if (method == "PUT") {
    const body = parseEvent(event);
    try {
      const params = {
        TableName: tableName,
        Key: {
          id: body?.id,
        },
        UpdateExpression: "set uri = :x",
        ExpressionAttributeValues: {
          ":x": body?.uri,
        },
      };

      const result = await docClient.update(params).promise();
      response = {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify(body),
      };
    } catch (err) {
      response = {
        statusCode: 400,
        headers: HEADERS,
        body: err.message,
      };
    }
  } else {
    response = {
      statusCode: 405,
      headers: HEADERS,
      body: JSON.stringify({ message: "Method not supported!" }),
    };
  }

  return response;
};

const parseEvent = (event) => {
  const body = JSON.parse(event.body);
  return body;
};
