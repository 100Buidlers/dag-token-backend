const fetch = require("node-fetch");
const uuid = require("uuid");
const AWS = require("aws-sdk");

globalThis.fetch = fetch;

const ethers = require("ethers");
const tbl = require("@tableland/sdk");

// const ALCHEMY_API_KEY = "w3P5g5S0SLQvDPksCjziSXMK-EJKiJMm";
const INFURA_API_KEY = "25f28dcc7e6b4c85b74ddfb3eeda03e5";

const SECRET_NAME = "wallet-keys";
const PUB_KEY = "0xc8B4a82A1cc76C62BeFB883906ec12E2F1b4feB6";
const NETWORK = "testnet";
const CHAIN_NAME = "polygon-mumbai";
const chain = tbl.SUPPORTED_CHAINS[CHAIN_NAME];
const CHAIN_ID = chain.chainId;

const TABLES = {
  user: {
    prefix: "user_table",
    columns: "uuid text, eoa text, primary key (uuid)",
    column_names: "uuid, eoa",
  },
  rule: {
    prefix: "rule_table",
    columns:
      "uuid text, name text, bytes text, graph text, creator text, primary key (uuid)",
    column_names: "uuid, name, bytes, graph, creator",
  },
  follow: {
    prefix: "follow_table",
    columns: "uuid text, user_uuid text , rule_uuid text, primary key (uuid)",
    column_names: "uuid, user_uuid, rule_uuid",
  },
};

const provider = new ethers.providers.InfuraProvider(
  chain.name,
  INFURA_API_KEY
);

exports.ruleGraphHandler = async (event) => {
  const method = event.httpMethod;
  let response = {
    statusCode: 200,
    body: JSON.stringify({ message: "default!" }),
  };

  // All log statements are written to CloudWatch
  console.info("[RuleGraph] Event:", JSON.stringify(event));

  const secret = await getSecretValue(SECRET_NAME);
  const wallet = new ethers.Wallet(secret[PUB_KEY]);

  // By default, `connect` uses the Tableland testnet validator;
  // it will sign a message using the associated wallet
  const signer = wallet.connect(provider);

  const tableland = await tbl.connect({
    signer,
    network: NETWORK,
    chain: CHAIN_NAME,
    rpcRelay: true,
  });

  // await createTables(tableland);

  if (method == "GET") {
    const { success, res } = await getRuleGraph(
      event?.queryStringParameters,
      tableland
    );
    response = res;
  } else if (method == "POST") {
    const body = parseEvent(event);
    const { success, res } = await postRuleGraph(body, tableland);
    response = res;
  } else if (method == "PUT") {
    const body = parseEvent(event);
    const { success, res } = await putRuleGraph(body, tableland);
    response = res;
  } else {
    return { statusCode: 405, message: "Method not supported!" };
  }

  return response;
};

const parseEvent = (event) => {
  const body = JSON.parse(event.body);
  return body;
};

const getTableName = async (tableland, prefix) => {
  const tables = await tableland.list();
  const name = tables.filter((item) => item.name.startsWith(prefix));

  return name.length ? name[0].name : null;
};

const getInsertValues = (columns, data) => {
  let valueArr = [];
  let columnArr = columns.replace(/\s+/g, "").split(",");
  let missing = [];
  for (const field of columnArr) {
    if (field == "uuid") {
      valueArr.push(`'${uuid.v4()}'`);
    } else {
      const value = data[field];
      if (!value) {
        missing.push(field);
        continue;
      }
      valueArr.push(`'${value}'`);
    }
  }

  if (missing.length) {
    return {
      success: false,
      message: `These fields are missing: ${missing.join(",")}`,
      values: null,
    };
  }

  return { success: true, values: valueArr.join(","), message: null };
};

const getUpdateValues = (columns, data) => {
  let valueArr = [];
  let columnArr = columns.replace(/\s+/g, "").split(",");
  for (const field of columnArr) {
    if (field == "uuid") {
      continue;
    } else {
      const value = data[field];
      if (!value) continue;
      valueArr.push(`${field}='${value}'`);
    }
  }

  if (!valueArr.length) {
    return {
      success: false,
      values: null,
      message: `Fields to update are missing!`,
    };
  }

  return { success: true, values: valueArr.join(","), message: null };
};

const getReadClauses = (columns, data) => {
  let clauseArr = [];
  let columnArr = columns.replace(/\s+/g, "").split(",");
  for (let [k, value] of Object.entries(data)) {
    if (!columnArr.includes(k)) continue;
    clauseArr.push(`${k}='${value}'`);
  }
  const clauses = clauseArr.join(" AND ");
  return clauses;
};

const getTableValues = async (tableland, name) => {
  const tableInfo = TABLES[name];
  if (!tableInfo) {
    return {
      success: false,
      res: {
        statusCode: 400,
        body: JSON.stringify({
          message: `${name} is a invalid table name! A valid table name is required in the body/param. [valid names: user/rule/follow]`,
        }),
      },
    };
  }

  const tableName = await getTableName(tableland, tableInfo.prefix);
  if (!tableName) {
    return {
      success: false,
      res: {
        statusCode: 404,
        body: JSON.stringify({ message: `No table found with name ${name}` }),
      },
    };
  }

  return { success: true, tableInfo, tableName };
};

const createTables = async (tableland) => {
  let tables = await tableland.list();
  // console.info("tables", JSON.stringify(tables));

  tables = tables.map((item) => item.name.split(`${CHAIN_ID}`)[0].slice(0, -1));

  for (let [key, value] of Object.entries(TABLES)) {
    if (tables.includes(value.prefix)) {
      console.info(`${value.prefix} Table already exists!`);
      continue;
    }

    try {
      const info = await tableland.create(value.columns, {
        prefix: value.prefix,
      });

      const res = {
        success: true,
        message: `${value.prefix} Table created successfully!`,
        data: info,
      };

      console.info(JSON.stringify(res));
    } catch (err) {
      const res = {
        success: false,
        message: `${value.prefix} Table could not be created!`,
        data: err.message,
      };
      console.error(JSON.stringify(res));
    }
  }
};

const getRuleGraph = async (params, tableland) => {
  console.info("params", JSON.stringify(params));
  const table = params.table;
  const { success, res, tableInfo, tableName } = await getTableValues(
    tableland,
    table
  );

  if (!success) return { success, res };

  const clauses = getReadClauses(tableInfo.column_names, params);
  const query = `SELECT * FROM ${tableName} ${
    !clauses.length ? "" : `WHERE ${clauses}`
  }`;
  console.info("query", query);
  const { rows, columns } = await tableland.read(query);

  const data = rows.map((item) => {
    let row = {};
    for (const [idx, value] of Object.entries(item)) {
      row[columns[idx].name] = value;
    }
    return row;
  });

  return {
    success: true,
    res: { statusCode: 200, body: JSON.stringify(data) },
  };
};

const postRuleGraph = async (body, tableland) => {
  const table = body.table;
  const { success, res, tableInfo, tableName } = await getTableValues(
    tableland,
    table
  );

  if (!success) return { success, res };

  const insertValues = getInsertValues(tableInfo.column_names, body);
  if (!insertValues.success) {
    return {
      success: false,
      res: {
        statusCode: 400,
        body: JSON.stringify({ message: insertValues.message }),
      },
    };
  }

  const query = `INSERT INTO ${tableName} (${tableInfo.column_names}) VALUES (${insertValues.values});`;
  console.info("query", query);
  const insertRes = await tableland.write(query);

  return {
    success: true,
    res: { statusCode: 200, body: JSON.stringify(insertRes) },
  };
};

const putRuleGraph = async (body, tableland) => {
  const uuid = body.uuid;

  if (!uuid) {
    return {
      success: false,
      res: {
        statusCode: 400,
        body: JSON.stringify({ message: "uuid field is required!" }),
      },
    };
  }

  const table = body.table;
  const { success, res, tableInfo, tableName } = await getTableValues(
    tableland,
    table
  );

  if (!success) return { success, res };

  const updateValues = getUpdateValues(tableInfo.column_names, body);
  if (!updateValues.success) {
    return {
      success: false,
      res: {
        statusCode: 400,
        body: JSON.stringify({ message: updateValues.message }),
      },
    };
  }

  const query = `UPDATE ${tableName} SET ${updateValues.values} WHERE uuid = '${uuid}';`;
  console.info("query", query);
  const updateRes = await tableland.write(query);

  return {
    success: true,
    res: { statusCode: 200, body: JSON.stringify(updateRes) },
  };
};

const getSecretValue = async (secretName) => {
  const client = new AWS.SecretsManager({ region: "us-east-1" });

  return new Promise((resolve, reject) => {
    client.getSecretValue({ SecretId: secretName }, function (err, data) {
      if (err) {
        reject(err);
      } else {
        let secret;
        if ("SecretString" in data) {
          secret = data.SecretString;
        } else {
          let buff = new Buffer(data.SecretBinary, "base64");
          secret = buff.toString("ascii");
        }
        resolve(JSON.parse(secret));
      }
    });
  });
};
