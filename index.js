const Promise = require("bluebird");
const _ = require("lodash");
const pathIsAbsolute = require("path-is-absolute");
const path = require("path");
const fs = Promise.promisifyAll(require("fs-extra"));
const stream = require("stream");
const spawn = require("child_process").spawn;
const execSync = require("child_process").execSync;
const yaml = require("js-yaml");

const composeConfV2 = {
  version: "2.4",
  services: {},
  volumes: {},
  networks: {}
};

function findAutocomposeFile() {
  let currentDir = process.cwd();
  const dirs = [];
  dirs.push(currentDir);

  do {
    currentDir = path.dirname(currentDir);
    dirs.push(currentDir);
  } while (currentDir !== "/");

  // Really weird way of getting of the each loop, it should be sync.
  return Promise.each(dirs, dir => {
    const autocomposePath = path.join(dir, "docker-compose.auto.yml");
    return fs.statAsync(autocomposePath).then(() => {
      return Promise.reject(autocomposePath);
    }, () => false);
  }).then(
    () => Promise.reject("not found"),
    filePath => {
      return readockerComposeFile(filePath);
    }
  );
}

function readockerComposeFile(filePath) {
  const obj = {
    services: {},
    networks: {},
    volumes: {}
  };
  readAndMergeDockerComposeFile(filePath, obj);
  return obj;
}

function readAndMergeDockerComposeFile(file, obj, rootPath) {
  if (!file) {
    return;
  }

  const absoluteFilePath = pathIsAbsolute(file) ? file : path.join(rootPath, file);
  const compose = yaml.safeLoad(fs.readFileSync(absoluteFilePath, "utf8"));
  const dirname = path.dirname(require.resolve(absoluteFilePath));

  _.each(compose.services, (autoService, name) => {
    if (!autoService) {
      autoService = {};
    }
    autoService.path = path.relative(process.cwd(), dirname) || ".";
    if (obj.services[name]) {
      console.warn(`Service definition ${name} already exists`);
    }
    obj.services[name] = fixPaths(autoService, dirname);
  });

  if (!obj.stackName) {
    obj.stackName = compose.stackName;
    obj.stackVersion = compose.stackVersion;
  }

  _.merge(obj.volumes, compose.volumes);
  _.merge(obj.networks, compose.networks);

  _.each(compose.includes, includeFile => {
    readAndMergeDockerComposeFile(includeFile, obj, dirname);
  });
}

function fixPaths(service, serviceDir) {
  return _.transform(
    service,
    (res, value, key) => {
      if (key === "context") {
        res[key] = fixPath(value, serviceDir);
      } else if (key === "volumes") {
        res[key] = _.map(value, volume => {
          const parts = volume.split(":");
          return fixPath(parts[0], serviceDir) + ":" + parts[1];
        });
      } else if (_.isString(value)) {
        res[key] = variableSubstitution(value);
      } else if (_.isArray(value)) {
        res[key] = value.map(variableSubstitution);
      } else if (_.isBoolean(value)) {
        res[key] = value;
      } else if (_.isNumber(value)) {
        res[key] = value;
      } else {
        res[key] = fixPaths(value, serviceDir);
      }
    },
    {}
  );
}

function variableSubstitution(value) {
  const match = value.match(/\%{[^}]+}/);
  let newValue = value;
  if (match) {
    const expression = match[0];
    let varContent = expression.substring(2, expression.length - 1);
    const fbPosition = varContent.indexOf(":");
    let fbContent = null;
    if (fbPosition > 0) {
      const parts = varContent.split(":");
      varContent = parts[0];
      fbContent = parts[1];
    }

    if (process.env[varContent]) {
      newValue = value.replace(expression, process.env[varContent]);
    } else if (fbContent) {
      newValue = value.replace(expression, fbContent);
    }
  }

  return newValue;
}

function fixPath(localPath, originalDir) {
  if (pathIsAbsolute(localPath)) {
    return localPath;
  }
  if (!localPath.startsWith(".") && !localPath.startsWith("~")) {
    return localPath;
  }
  let relativePath = path.join("./", path.relative(process.cwd(), path.resolve(originalDir, localPath)));
  if (relativePath[0] !== ".") {
    relativePath = "./" + relativePath;
  }
  return relativePath;
}

function getComposeServices() {
  let currentDir = process.cwd();
  const dirs = [];
  dirs.push(currentDir);

  do {
    currentDir = path.dirname(currentDir);
    dirs.push(currentDir);
  } while (currentDir !== "/");

  return findAutocomposeFile().then(obj => {
    const aggregatedServices = _.reduce(
      obj.services,
      (res, service, name) => {
        if (name.indexOf(":") < 0) {
          res[name] = service;
          res[name].options = {};
        }
        return res;
      },
      {}
    );

    _.each(obj.services, (service, name) => {
      if (name.indexOf(":") >= 0) {
        const parts = name.split(":");
        const serviceName = parts[0];
        const option = parts[1];
        if (!aggregatedServices[serviceName]) {
          aggregatedServices[serviceName] = {
            options: {}
          };
        }
        aggregatedServices[serviceName].options[option] = service;
      }
    });
    obj.services = aggregatedServices;
    return obj;
  });
}

function generateComposeFile(servicesConf) {
  return getComposeServices().then(obj => {
    const composeConf = composeConfV2;
    const servicesToLaunch = [];
    composeConf.volumes = obj.volumes;
    composeConf.networks = obj.networks;

    _.each(servicesConf, serviceConf => {
      const components = serviceConf.split(":");
      const serviceName = components[0];
      if (!obj.services[serviceName]) {
        throw Error("service not found " + serviceName);
      }
      const service = obj.services[serviceName];
      servicesToLaunch.push(serviceName);

      let conf = _.cloneDeep(service);

      for (let i = 1; i < components.length; i++) {
        let option = components[i];
        if (option[0] === "-") {
          option = option.substring(1);
          conf = {};
        }
        if (service.options[option]) {
          _.mergeWith(conf, service.options[option], (objValue, srcValue) => {
            if (_.isArray(objValue)) {
              return objValue.concat(srcValue);
            }
          });
        } else {
          throw Error("options not found " + option + " for service " + serviceName);
        }
      }
      delete conf.options;
      delete conf.path;

      composeConf.services[serviceName] = conf;
    });

    return {
      conf: composeConf,
      servicesNames: servicesToLaunch
    };
  });
}

function getFullComposeFile() {
  return getComposeServices().then(obj => {
    const composeConf = composeConfV2;
    composeConf.volumes = obj.volumes;
    composeConf.networks = obj.networks;

    _.each(obj.services, (service, serviceName) => {
      const conf = _.cloneDeep(service);
      delete conf.options;
      delete conf.path;
      composeConf.services[serviceName] = conf;
    });

    return {
      conf: composeConf,
      servicesNames: null
    };
  });
}

function getComposeFile(servicesConf) {
  if (!servicesConf || !servicesConf.length) {
    return getFullComposeFile();
  }
  return generateComposeFile(servicesConf);
}

function generate(outputFile, serviceConf) {
  return getComposeFile(serviceConf).then(obj => {
    return fs.writeFileAsync(path.join(process.cwd(), outputFile), yaml.safeDump(obj.conf));
  });
}

function spawnDockerCompose(composeConf, pArgs, command, cargs, services, args) {
  const launchParams = pArgs
    .concat(["-f", "-", "-p", "swadmap", command])
    .concat(cargs)
    .concat(services)
    .concat(args)
    .map(s => s.trim());
  console.log(`docker-compose ${launchParams.join(" ")}`);
  // process.exit();
  const child = spawn("docker-compose", launchParams, {
    stdio: ["pipe", 1, 2]
  });

  const s = new stream.Readable();
  s._read = function noop() {};
  s.push(JSON.stringify(composeConf));
  s.push(null);

  s.pipe(child.stdin);

  return new Promise((resolve, reject) => {
    child.on("error", err => {
      console.error("Failed to start docker-compose.");
      reject(1);
    });

    child.on("close", code => {
      //console.log(`child process exited with code ${code}`);
      if (code > 0) {
        reject(code);
      } else {
        resolve(code);
      }
    });
  });
}

module.exports = {
  getComposeServices: getComposeServices,
  getComposeFile: getComposeFile,
  generate: generate,
  spawnDockerCompose: spawnDockerCompose
};
