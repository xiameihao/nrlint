/**
 * Copyright JS Foundation and other contributors, http://js.foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

/* 
 * flow linter plugin for loop detection 
 */
function isLooped(path) { // does a node id appears multiple times ?
    return path.map(e => path.filter(f => f === e).length).some(e => e >= 2);
}

function isSubset(array1, array2) {  // is an array1 a subset of an array2 ?
    return array1.every(e => array2.includes(e)) && !array2.every(e => array1.includes(e));
}

function isSameLoop(array1, array2) {
    return array1.every(e => array2.includes(e)) && array2.every(e => array1.includes(e));
}

/**
 * enumerate loops in flows
 * @param {FlowSet} afs FlowSet
 * @returns {string[][]}Array of loops 
 */
function enumLoops(afs) {
    let loops = [];
    let allNodes = afs.getAllNodesArray().map(n => n.id); 

    allNodes.forEach((nid) => { // traverse a flow from nid 
        let visitingPaths = [[ nid ]];
        while (visitingPaths.length > 0) {
            visitingPaths = visitingPaths.reduce((acc, cur) => {
                const nextHops = afs.next(cur[cur.length-1]);
                if (nextHops.length > 0) {
                    const nextPaths = nextHops.map(e => cur.concat(e));
                    nextPaths.forEach(path => {if (isLooped(path)) { loops.push(path); }});
                    return acc.concat(nextPaths.filter(path => !isLooped(path)));
                } else {
                    return acc;
                }
            }, []);
        }
    });
    // eliminate duplication of loops
    const uniqLoops = loops
        .reduce((acc,cur) => {   // elimination of identical paths
            if (acc.some(e => isSameLoop(e,cur))) {
                return acc;
            } else {
                return acc.concat([cur]);
            }
        },[])
        .filter(path => loops.every(e => !isSubset(e, path))); // extract minimum loop element

    return uniqLoops;
}

/**
 * Loop detection in a flow.
 * @param {FlowSet} afs complete flow set
 * @param {*} conf configuration for this rule. {name: "loop"}
 * @param {*} cxt context
 * @returns {context, result: [{rule: "loop", ids: [flowid], name: "loop", severity: "warn", message: "possible infinite loop detected"}]}
 */
function checkLoop(afs, conf, cxt) {
    const loops = enumLoops(afs);

    return {
        context: cxt,
        result: loops.map(l => {return {rule: "loop", ids: l, severity: "warn", name: "loop", message: "possible infinite loop detected"};})
    };
}

/**
 * Does HTTP-in node has corresponding HTTP-response node? 
 * @param {FlowSet} afs complete flow set
 * @param {*} conf configuration for this rule. {name: "http-in-resp"}
 * @param {*} cxt context
 * @returns {context, result: [{rule: "http-in-resp", ids: [flowid], name: "dangling-http-in/resp", severity: "warn", message: "dangling http-in node"}]}
 */
function checkHttpInResp(afs, conf, cxt) {
    const danglingHttpIns = afs.getAllNodesArray()
        .filter(e => e.type === 'http in')
        .filter(e => {
            const ds = afs.downstream(e.id);
            return ds.length === 0 || ds.every(i => afs.getNode(i).type != 'http response');
        })
        .map(e => ({rule:"http-in-resp", ids: [e.id], name: "dangling-http-in", severity: "warn", message: "dangling http-in node"}));

    const danglingHttpResponses = afs.getAllNodesArray()
        .filter(e => e.type==='http response')
        .filter(e => {
            const ds = afs.upstream(e.id);
            return ds.length === 0 || ds.every(i => afs.getNode(i).type != 'http in');
        })
        .map(e => ({rule:"http-in-resp", ids: [e.id], name: "dangling-http-resp", severity: "warn", message: "dangling http-response node"}));

    return {context: cxt, result: danglingHttpIns.concat(danglingHttpResponses)};
} 

/**
 * Check size of each flow
 * @param {FlowSet} afs complete flow set
 * @param {*} conf configuration for this rule. {name: "flowsize", maxSize: number }
 * @param {*} cxt context
 * @returns {context, result: [{rule: "core", ids: [flowid], name: "flowsize", severity: "warn", message: "too large flow size"}]}
 */
function checkFlowSize(afs, conf, cxt) {
    const flows = afs.flows;
    const result = [];

    flows.forEach((flow) => {
        const nodes = flow.nodes;
        let maxSize = 100;
        if (conf.hasOwnProperty("maxSize")) {
            maxSize = conf.maxSize;
        }
        if (nodes.length > maxSize) {
            result.push({rule: "core", ids: [flow.id], name: "flowsize", severity: "warn", message: "too large flow size" } );
        }
    });

    return {
        context: cxt,
        result: result
    };
}

/**
 * check an existence of name of a function node 
 * @param {FlowSet} afs complete flow set
 * @param {*} conf configuration for this rule. {name: "no-func-name", maxSize: number }
 * @param {*} cxt context
 * @returns {context, result: [{rule: "no-func-name", ids: [flowid], name: "no-func-name", severity: "warn", message: "function node has no name"}]}
 */
function checkNoFuncName(afs, conf, cxt) {
    var funcs = afs.getAllNodesArray()
        .filter( (e) => {return e.type==='function';})
        .map(function (e) {
            return {id:e.id, name:e.name};
        });
    var verified = funcs
        .filter(function (e) {return e.name === undefined || e.name === "";})
        .map(function (e){
            return {rule:"no-func-name", ids: [e.id], severity: "warn", name: "no-func-name", message: "function node has no name"};
        });

    return {context: cxt, result: verified};
}

const ruleMap = {
    "flowsize": checkFlowSize,
    "no-func-name": checkNoFuncName,
    "http-in-resp": checkHttpInResp,
    "loop": checkLoop
};

/**
 * nrlint core rules
 * @param {FlowSet} afs complete flow set
 * @param {*} conf configuration for this rule. {name: "core", subrules: [{name: "flowsize", maxSize: number },...]}
 * @param {*} cxt context
 * @returns {*} {context, result: [{rule: "flowsize", ids: [flowid], name: "core", severity: "warn", message: "..."}]}
 */
function check(afs, conf, cxt) {
    let results = [];
    if (Array.isArray(conf.subrules)) {
        conf.subrules.forEach(e => {
            let retval;
            if (ruleMap.hasOwnProperty(e.name)) {
                retval = ruleMap[e.name](afs, e, cxt);
            } else {
                retval = {result: [], context: cxt};
            }
            results = results.concat(retval.result);
            cxt = retval.context;
        });
    }
    return {context: cxt, result: results};
}

module.exports = {
    check: check
};
