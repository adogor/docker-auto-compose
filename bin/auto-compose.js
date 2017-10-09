#!/usr/bin/env node
const program = require('commander');
const autocompose = require('../');
const chalk = require('chalk');
const yaml = require('js-yaml');

program.description('auto-compose');

program.option('-p, --project <name>', 'Project name');

const commands = {
  up: {
    regex: /^((?:.*) )?up ((?:-+[^ -]+ (?:[^ -]+ )??)*)?((?:[^- ][^ ]* ?)*)$/,
    argsName: ['pArgs', 'args', 'services'],
  },
  down: {
    regex: /^((?:.*) )?down ((?:-+[^ -]+ (?:[^ -]+ )??)*)?((?:[^- ][^ ]* ?)*)$/,
    argsName: ['pArgs', 'args', 'services'],
    noServices: true,
  },
  run: {
    regex: /^(?:(.*) )??run ((?:-+[^ -]+ (?:[^ -]+ )??)*)((?:-e [^= ]=[^= ] )*)([^- ][^ ]*)( .*)?$/,
    argsName: ['pArgs', 'args', 'env', 'services', 'cArgs'],
  },
  ps: {
    regex: /^((?:.*) )?ps ?((?:-+[^ -]+ (?:[^ -]+ )??)*)?((?:[^- ][^ ]* ?)*)?$/,
    argsName: ['pArgs', 'args', 'services'],
  },
  logs: {
    regex: /^((?:.*) )?logs ?((?:-+[^ -]+ (?:[^ -]+ )??)*)?((?:[^- ][^ ]* ?)*)?$/,
    argsName: ['pArgs', 'args', 'services'],
  },
}

function make_red(txt) {
  return chalk.red(txt); //display the help text in red on the console
}

var ok = false;

// program
//   .command('up [services...]')
//   .option('--build', 'Build')
//   .option('-d, --detach', 'detach')
//   .action((services, options) => {
//     ok = true;
//     opts = [];
//     if (options.build) {
//       opts.push('--build');
//     }

//     if (options.detach) {
//       opts.push('-d');
//     }
//     //console.log(program, opts, options);
//     //process.exit();

//     autocompose.up(program.project, services, opts)
//       .then(() => {
//         console.log('Services launched');
//       })
//       .catch((err) => {
//         console.error(err.message);
//         process.exit(1);
//       })
//   });

// program
//   .command('run <service> [args...]')
//   .action((service, args, options) => {
//     ok = true;
//     //const command = args.join(' ');
//     //console.log(program, opts, options);
//     //process.exit();

//     autocompose.run(program.project, service, args)
//       .then(() => {
//         console.log('Services launched');
//       })
//       .catch((err) => {
//         console.error(err.message);
//         process.exit(1);
//       })
//   });

// program
//   .command('down [services...]')
//   .action((services) => {
//     ok = true;
//     autocompose.down(program.project, services)
//       .then(() => {
//         console.log('Services down');
//       })
//       .catch((err) => {
//         console.error(err.message);
//         process.exit(1);
//       })
//   });

// program
//   .command('ps [services...]')
//   .option('-q, --id-only', 'Ids only')
//   .action((services, options) => {
//     ok = true;
//     opts = [];
//     if (options.idOnly) {
//       opts.push('-q');
//     }

//     autocompose.ps(program.project, services, opts)
//       .catch((err) => {
//         console.error(err.message);
//         process.exit(1);
//       })
//   });

// program
//   .command('build [services...]')
//   .action((services) => {
//     ok = true;
//     autocompose.build(program.project, services)
//       .then(() => {
//         console.log('Services launched');
//       })
//       .catch((err) => {
//         console.error(err.message);
//         process.exit(1);
//       })
//   });


program
  .command('list')
  .description('List services available')
  .action(function(cmd, options) {
    ok = true;
    autocompose.getComposeServices()
      .then(function(packages) {
        console.dir(packages, {
          depth: null
        })
      })
      .catch(function(e) {
        console.error(e);
        process.exit(1);
      })
  });

// program
  //   .command('logs [services...]')
  //   .action((services) => {
  //     ok = true;
  //     autocompose.logs(program.project, services)
  //       .then(() => {
  //         console.log('Services launched');
  //       })
  //       .catch((err) => {
  //         console.error(err.message);
  //         process.exit(1);
  //       })
  //   });

program
  .command('dry [services...]')
  .description('List services available')
  .action(function(services) {
    ok = true;
    autocompose.getComposeFile(services)
      .then(function(conf) {
        console.log(yaml.safeDump(conf.conf));
      })
      .catch(function(e) {
        console.error(e);
        process.exit(1);
      })
  });

program
  .command('generate <outputFile> [services...]')
  .description('Aggregate services conf')
  .action(function(outputFile, services) {
    ok = true;
    autocompose.generate(outputFile, services)
      .then(() => {
        console.log('File generated');
      })
      .catch((err) => {
        console.error(err);
        process.exit(1);
      })
  });

//

function exec(execObj) {
  autocompose.getComposeFile(execObj.services ? execObj.services.split(' ') : null)
    .then((obj) => {
      return autocompose.spawnDockerCompose(obj.conf,
        execObj.pArgs ? execObj.pArgs.trim().split(' ') : [],
        execObj.command,
        execObj.args ? execObj.args.trim().split(' ') : [],
        execObj.cmdObj.noServices ? [] : obj.servicesNames || [],
        execObj.cArgs ? execObj.cArgs.trim().split(' ') : []);
    })
    .catch((err) => {
      console.log(chalk.red(err));
      process.exit(1);
    });
}

const argString = process.argv.slice(2).join(' ');
// console.log(argString)
Object.keys(commands).forEach((key) => {
  const cmdObj = commands[key];

  const matches = argString.match(cmdObj.regex);
  const execObj = {};
  if (matches) {
    ok = true;

    cmdObj.argsName.forEach((name, i) => {
      execObj[name] = matches[i + 1];
      if (execObj[name]) {
        execObj[name] = execObj[name].trim();
      }
    });
    execObj.command = key;
    execObj.cmdObj = cmdObj;
    exec(execObj);
  }
});

if (!ok) {
  program.parse(process.argv);
}

if (!ok) {
  program.outputHelp(make_red);
  process.exit(1);
}
