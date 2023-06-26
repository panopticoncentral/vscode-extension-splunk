import * as splunk from 'splunk-sdk';
import * as needle from 'needle'; // transitive dependency of splunk-sdk
import * as vscode from 'vscode';
import { SplunkMessage } from './utils';

export function getClient() {
    const config = vscode.workspace.getConfiguration();
    const restUrl = config.get<string>('splunk.commands.splunkRestUrl');
    const token = config.get<string>('splunk.commands.token');

    let url = new URL(restUrl);
    const scheme = url.protocol.replace(':', '');
    const port = url.port;
    const host = url.hostname;

    let service = new splunk.Service({
        scheme: scheme,
        host: host,
        port: port,
        sessionKey: token,
        version: '8',
        authorization: 'Bearer',
    });

    return service;
}

export function splunkLogin(service) {

    return new Promise(function(resolve, reject) {
        
        service.login(function(err, wasSuccessful) {
            if (err !== null || !wasSuccessful) {
                reject(err);
            } else {
                resolve(null);
            }
        });

    });


}


export function createSearchJob(jobs, query, options) {
    return new Promise(function(resolve, reject) {
        jobs.create(query, options, function(err, data) {
            if (err !== null) {
                reject(err);
            } else {
                resolve(data);
            }
        });

    });
}

export function dispatchSpl2Module(service: any, spl2Module: string) {
    // Get last statement assignment '$my_statement = ...' -> 'my_statement' 
    const statementMatches = [...spl2Module.matchAll(/\$([a-zA-Z0-9_]+)[\s]*=/gm)];
    if (!statementMatches
        || statementMatches.length < 1
        || statementMatches[statementMatches.length - 1].length < 2) {
        throw new Error(
            'No statements found in SPL2. Please assign at least one statement name ' +
            'using "$". For example: `$my_statement = from _internal`'
        );
    }
    const statementIdentifier = statementMatches[statementMatches.length - 1][1];

    // The Splunk SDK for Javascript doesn't currently support the spl2-module-dispatch endpoint
    // nor does it support sending requests in JSON format (only receiving responses), so
    // for now use the underlying needle library that the SDK uses for requests/responses
    return needle(
        'POST',
        `${service.prefix}/services/search/spl2-module-dispatch`,
        {
            'module': spl2Module,
            'namespace': '',
            'queryParameters': {
                [statementIdentifier]: {
                    'timezone': 'Etc/UTC',
                    'collectFieldSummary': true,
                    'collectEventSummary': false,
                    'collectTimeBuckets': false,
                    'output_mode': 'json_cols',
                    'status_buckets': 300,
                }
            }
        },
        {
            'headers': {
                'Authorization': `Bearer ${service.sessionKey}`,
                'Content-Type': 'application/json',
            },
            'followAllRedirects': true,
            'timeout': 0,
            'strictSSL': false,
            'rejectUnauthorized' : false,
        })
        .then((response) => {
            const data = response.body;
            if (!Array.prototype.isPrototypeOf(data) || data.length < 1) {
                // Response is not in expected successful format, let's handle a
                // few different error cases and raise as expected messages format
                let messages:SplunkMessage[] = [];
                if (Object.prototype.isPrototypeOf(data)) {
                    if (data.name === 'response'
                        && Array.prototype.isPrototypeOf(data.children)) {
                        // Reformat messages for errors such as unauthorized
                        messages = data.children
                            .filter((child) => child.name === 'messages')
                            .flatMap((msgs) => msgs.children)
                            .map((msg) => new Object({
                                    'type': msg?.attributes?.type,
                                    'code': msg.name,
                                    'text': msg.value,
                            }));
                    } else if (data.code !== undefined && data.message !== undefined) {
                        // Reformat if returns a `code` and `message for errors such
                        // as invalid request body format
                        messages = [{
                            'type': 'error',
                            'code': data.code,
                            'text': data.message,
                        }];
                    }
                }
                // If we still haven't handled this unsuccessful response then simply
                // output the body as an error message
                if (messages.length === 0) {
                    messages = [{
                        'type': 'error',
                        'code': '',
                        'text': `Error dispatching SPL2: ${JSON.stringify(data)}`,
                    }];
                }
                throw new Object({
                    'data': {
                        'messages': messages,
                    },
                }); 
            }
            // This is in the expected successful response format
            const sid = data[0]['sid'];
            return getSearchJobBySid(service, sid);
        });
}

export function getSearchJobBySid(service, sid) {
    return new Promise(function(resolve, reject) {
        service.getJob(sid, function(err, data) {
            if (err != null) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
}


export function getSearchJob(job) {
    return new Promise(function(resolve, reject) {
        job.fetch(function(err, job) {
            if (err !== null) {
                reject(err);
            } else {
                resolve(job);
            }
        });

    });
}

export function getJobSearchLog(job) {
    return new Promise(function(resolve, reject) {
        job.searchlog(function(err, log) {
            if (err !== null) {
                reject(err);
            } else {
                resolve(log);
            }
        });

    });
}

export function getSearchJobResults(job) {
    return new Promise(function(resolve, reject) {
        job.get("results", {"output_mode": "json_cols"},function(err, results) {
            if (err !== null) {
                reject(err);
            } else {
                resolve(results);
            }
        });

    });
}

export function cancelSearchJob(job) {
    return new Promise(function(resolve, reject) {
        job.cancel(function(err, results) {
            if (err !== null) {
                reject(err);
            } else {
                resolve(results);
            }

        });
    });
}

export function wait(ms = 1000) {
    return new Promise(resolve => {
      setTimeout(resolve, ms);
    });
}