(function(){
// Copyright 2011 Google Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
var __extends = this.__extends || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    __.prototype = b.prototype;
    d.prototype = new __();
};
var MutationObserverCtor;
if (typeof WebKitMutationObserver !== 'undefined')
    MutationObserverCtor = WebKitMutationObserver;
else
    MutationObserverCtor = MutationObserver;

if (MutationObserverCtor === undefined) {
    console.error('DOM Mutation Observers are required.');
    console.error('https://developer.mozilla.org/en-US/docs/DOM/MutationObserver');
    throw Error('DOM Mutation Observers are required');
}

var NodeMap = (function () {
    function NodeMap() {
        this.nodes = [];
        this.values = [];
    }
    NodeMap.prototype.isIndex = function (s) {
        return +s === s >>> 0;
    };

    NodeMap.prototype.nodeId = function (node) {
        var id = node[NodeMap.ID_PROP];
        if (!id)
            id = node[NodeMap.ID_PROP] = NodeMap.nextId_++;
        return id;
    };

    NodeMap.prototype.set = function (node, value) {
        var id = this.nodeId(node);
        this.nodes[id] = node;
        this.values[id] = value;
    };

    NodeMap.prototype.get = function (node) {
        var id = this.nodeId(node);
        return this.values[id];
    };

    NodeMap.prototype.has = function (node) {
        return this.nodeId(node) in this.nodes;
    };

    NodeMap.prototype.delete = function (node) {
        var id = this.nodeId(node);
        delete this.nodes[id];
        this.values[id] = undefined;
    };

    NodeMap.prototype.keys = function () {
        var nodes = [];
        for (var id in this.nodes) {
            if (!this.isIndex(id))
                continue;
            nodes.push(this.nodes[id]);
        }

        return nodes;
    };
    NodeMap.ID_PROP = '__mutation_summary_node_map_id__';
    NodeMap.nextId_ = 1;
    return NodeMap;
})();

function NodeIdMap(){
    NodeMap.call(this);
    this.byId = {}; // Id -> Node
}
NodeIdMap.prototype = new NodeMap();
NodeIdMap.prototype.delete = function(node) {
    var id = this.get(node);
    if(id){
        NodeMap.prototype.delete.call(this, node);
        delete this.byId[id];
    }
};
NodeIdMap.prototype.set = function(node, id) {
    NodeMap.prototype.set.call(this, node, id);
    this.byId[id] = node;
};
/**
*  var reachableMatchableProduct = [
*  //  STAYED_OUT,  ENTERED,     STAYED_IN,   EXITED
*    [ STAYED_OUT,  STAYED_OUT,  STAYED_OUT,  STAYED_OUT ], // STAYED_OUT
*    [ STAYED_OUT,  ENTERED,     ENTERED,     STAYED_OUT ], // ENTERED
*    [ STAYED_OUT,  ENTERED,     STAYED_IN,   EXITED     ], // STAYED_IN
*    [ STAYED_OUT,  STAYED_OUT,  EXITED,      EXITED     ]  // EXITED
*  ];
*/
var Movement;
(function (Movement) {
    Movement[Movement["STAYED_OUT"] = 0] = "STAYED_OUT";
    Movement[Movement["ENTERED"] = 1] = "ENTERED";
    Movement[Movement["STAYED_IN"] = 2] = "STAYED_IN";
    Movement[Movement["REPARENTED"] = 3] = "REPARENTED";
    Movement[Movement["REORDERED"] = 4] = "REORDERED";
    Movement[Movement["EXITED"] = 5] = "EXITED";
})(Movement || (Movement = {}));

function enteredOrExited(changeType) {
    return changeType === 1 /* ENTERED */ || changeType === 5 /* EXITED */;
}

var NodeChange = (function () {
    function NodeChange(node, childList, attributes, characterData, oldParentNode, added, attributeOldValues, characterDataOldValue) {
        if (typeof childList === "undefined") { childList = false; }
        if (typeof attributes === "undefined") { attributes = false; }
        if (typeof characterData === "undefined") { characterData = false; }
        if (typeof oldParentNode === "undefined") { oldParentNode = null; }
        if (typeof added === "undefined") { added = false; }
        if (typeof attributeOldValues === "undefined") { attributeOldValues = null; }
        if (typeof characterDataOldValue === "undefined") { characterDataOldValue = null; }
        this.node = node;
        this.childList = childList;
        this.attributes = attributes;
        this.characterData = characterData;
        this.oldParentNode = oldParentNode;
        this.added = added;
        this.attributeOldValues = attributeOldValues;
        this.characterDataOldValue = characterDataOldValue;
        this.isCaseInsensitive = this.node.nodeType === Node.ELEMENT_NODE && this.node instanceof HTMLElement && this.node.ownerDocument instanceof HTMLDocument;
    }
    NodeChange.prototype.getAttributeOldValue = function (name) {
        if (!this.attributeOldValues)
            return undefined;
        if (this.isCaseInsensitive)
            name = name.toLowerCase();
        return this.attributeOldValues[name];
    };

    NodeChange.prototype.getAttributeNamesMutated = function () {
        var names = [];
        if (!this.attributeOldValues)
            return names;
        for (var name in this.attributeOldValues) {
            names.push(name);
        }
        return names;
    };

    NodeChange.prototype.attributeMutated = function (name, oldValue) {
        this.attributes = true;
        this.attributeOldValues = this.attributeOldValues || {};

        if (name in this.attributeOldValues)
            return;

        this.attributeOldValues[name] = oldValue;
    };

    NodeChange.prototype.characterDataMutated = function (oldValue) {
        if (this.characterData)
            return;
        this.characterData = true;
        this.characterDataOldValue = oldValue;
    };

    // Note: is it possible to receive a removal followed by a removal. This
    // can occur if the removed node is added to an non-observed node, that
    // node is added to the observed area, and then the node removed from
    // it.
    NodeChange.prototype.removedFromParent = function (parent) {
        this.childList = true;
        if (this.added || this.oldParentNode)
            this.added = false;
        else
            this.oldParentNode = parent;
    };

    NodeChange.prototype.insertedIntoParent = function () {
        this.childList = true;
        this.added = true;
    };

    // An node's oldParent is
    //   -its present parent, if its parentNode was not changed.
    //   -null if the first thing that happened to it was an add.
    //   -the node it was removed from if the first thing that happened to it
    //      was a remove.
    NodeChange.prototype.getOldParent = function () {
        if (this.childList) {
            if (this.oldParentNode)
                return this.oldParentNode;
            if (this.added)
                return null;
        }

        return this.node.parentNode;
    };
    return NodeChange;
})();

var ChildListChange = (function () {
    function ChildListChange() {
        this.added = new NodeMap();
        this.removed = new NodeMap();
        this.maybeMoved = new NodeMap();
        this.oldPrevious = new NodeMap();
        this.moved = undefined;
    }
    return ChildListChange;
})();

var TreeChanges = (function (_super) {
    __extends(TreeChanges, _super);
    function TreeChanges(rootNode, mutations) {
        _super.call(this);

        this.rootNode = rootNode;
        this.reachableCache = undefined;
        this.wasReachableCache = undefined;
        this.anyParentsChanged = false;
        this.anyAttributesChanged = false;
        this.anyCharacterDataChanged = false;

        for (var m = 0; m < mutations.length; m++) {
            var mutation = mutations[m];
            switch (mutation.type) {
                case 'childList':
                    this.anyParentsChanged = true;
                    for (var i = 0; i < mutation.removedNodes.length; i++) {
                        var node = mutation.removedNodes[i];
                        this.getChange(node).removedFromParent(mutation.target);
                    }
                    for (var i = 0; i < mutation.addedNodes.length; i++) {
                        var node = mutation.addedNodes[i];
                        this.getChange(node).insertedIntoParent();
                    }
                    break;

                case 'attributes':
                    this.anyAttributesChanged = true;
                    var change = this.getChange(mutation.target);
                    change.attributeMutated(mutation.attributeName, mutation.oldValue);
                    break;

                case 'characterData':
                    this.anyCharacterDataChanged = true;
                    var change = this.getChange(mutation.target);
                    change.characterDataMutated(mutation.oldValue);
                    break;
            }
        }
    }
    TreeChanges.prototype.getChange = function (node) {
        var change = this.get(node);
        if (!change) {
            change = new NodeChange(node);
            this.set(node, change);
        }
        return change;
    };

    TreeChanges.prototype.getOldParent = function (node) {
        var change = this.get(node);
        return change ? change.getOldParent() : node.parentNode;
    };

    TreeChanges.prototype.getIsReachable = function (node) {
        if (node === this.rootNode)
            return true;
        if (!node)
            return false;

        this.reachableCache = this.reachableCache || new NodeMap();
        var isReachable = this.reachableCache.get(node);
        if (isReachable === undefined) {
            isReachable = this.getIsReachable(node.parentNode);
            this.reachableCache.set(node, isReachable);
        }
        return isReachable;
    };

    // A node wasReachable if its oldParent wasReachable.
    TreeChanges.prototype.getWasReachable = function (node) {
        if (node === this.rootNode)
            return true;
        if (!node)
            return false;

        this.wasReachableCache = this.wasReachableCache || new NodeMap();
        var wasReachable = this.wasReachableCache.get(node);
        if (wasReachable === undefined) {
            wasReachable = this.getWasReachable(this.getOldParent(node));
            this.wasReachableCache.set(node, wasReachable);
        }
        return wasReachable;
    };

    TreeChanges.prototype.reachabilityChange = function (node) {
        if (this.getIsReachable(node)) {
            return this.getWasReachable(node) ? 2 /* STAYED_IN */ : 1 /* ENTERED */;
        }

        return this.getWasReachable(node) ? 5 /* EXITED */ : 0 /* STAYED_OUT */;
    };
    return TreeChanges;
})(NodeMap);

var MutationProjection = (function () {
    // TOOD(any)
    function MutationProjection(rootNode, mutations, selectors, calcReordered, calcOldPreviousSibling) {
        this.rootNode = rootNode;
        this.mutations = mutations;
        this.selectors = selectors;
        this.calcReordered = calcReordered;
        this.calcOldPreviousSibling = calcOldPreviousSibling;
        this.treeChanges = new TreeChanges(rootNode, mutations);
        this.entered = [];
        this.exited = [];
        this.stayedIn = new NodeMap();
        this.visited = new NodeMap();
        this.childListChangeMap = undefined;
        this.characterDataOnly = undefined;
        this.matchCache = undefined;

        this.processMutations();
    }
    MutationProjection.prototype.processMutations = function () {
        if (!this.treeChanges.anyParentsChanged && !this.treeChanges.anyAttributesChanged)
            return;

        var changedNodes = this.treeChanges.keys();
        for (var i = 0; i < changedNodes.length; i++) {
            this.visitNode(changedNodes[i], undefined);
        }
    };

    MutationProjection.prototype.visitNode = function (node, parentReachable) {
        if (this.visited.has(node))
            return;

        this.visited.set(node, true);

        var change = this.treeChanges.get(node);
        var reachable = parentReachable;

        // node inherits its parent's reachability change unless
        // its parentNode was mutated.
        if ((change && change.childList) || reachable == undefined)
            reachable = this.treeChanges.reachabilityChange(node);

        if (reachable === 0 /* STAYED_OUT */)
            return;

        // Cache match results for sub-patterns.
        this.matchabilityChange(node);

        if (reachable === 1 /* ENTERED */) {
            this.entered.push(node);
        } else if (reachable === 5 /* EXITED */) {
            this.exited.push(node);
            this.ensureHasOldPreviousSiblingIfNeeded(node);
        } else if (reachable === 2 /* STAYED_IN */) {
            var movement = 2 /* STAYED_IN */;

            if (change && change.childList) {
                if (change.oldParentNode !== node.parentNode) {
                    movement = 3 /* REPARENTED */;
                    this.ensureHasOldPreviousSiblingIfNeeded(node);
                } else if (this.calcReordered && this.wasReordered(node)) {
                    movement = 4 /* REORDERED */;
                }
            }

            this.stayedIn.set(node, movement);
        }

        if (reachable === 2 /* STAYED_IN */)
            return;

        for (var child = node.firstChild; child; child = child.nextSibling) {
            this.visitNode(child, reachable);
        }
    };

    MutationProjection.prototype.ensureHasOldPreviousSiblingIfNeeded = function (node) {
        if (!this.calcOldPreviousSibling)
            return;

        this.processChildlistChanges();

        var parentNode = node.parentNode;
        var nodeChange = this.treeChanges.get(node);
        if (nodeChange && nodeChange.oldParentNode)
            parentNode = nodeChange.oldParentNode;

        var change = this.childListChangeMap.get(parentNode);
        if (!change) {
            change = new ChildListChange();
            this.childListChangeMap.set(parentNode, change);
        }

        if (!change.oldPrevious.has(node)) {
            change.oldPrevious.set(node, node.previousSibling);
        }
    };

    MutationProjection.prototype.getChanged = function (summary, selectors, characterDataOnly) {
        this.selectors = selectors;
        this.characterDataOnly = characterDataOnly;

        for (var i = 0; i < this.entered.length; i++) {
            var node = this.entered[i];
            var matchable = this.matchabilityChange(node);
            if (matchable === 1 /* ENTERED */ || matchable === 2 /* STAYED_IN */)
                summary.added.push(node);
        }

        var stayedInNodes = this.stayedIn.keys();
        for (var i = 0; i < stayedInNodes.length; i++) {
            var node = stayedInNodes[i];
            var matchable = this.matchabilityChange(node);

            if (matchable === 1 /* ENTERED */) {
                summary.added.push(node);
            } else if (matchable === 5 /* EXITED */) {
                summary.removed.push(node);
            } else if (matchable === 2 /* STAYED_IN */ && (summary.reparented || summary.reordered)) {
                var movement = this.stayedIn.get(node);
                if (summary.reparented && movement === 3 /* REPARENTED */)
                    summary.reparented.push(node);
                else if (summary.reordered && movement === 4 /* REORDERED */)
                    summary.reordered.push(node);
            }
        }

        for (var i = 0; i < this.exited.length; i++) {
            var node = this.exited[i];
            var matchable = this.matchabilityChange(node);
            if (matchable === 5 /* EXITED */ || matchable === 2 /* STAYED_IN */)
                summary.removed.push(node);
        }
    };

    MutationProjection.prototype.getOldParentNode = function (node) {
        var change = this.treeChanges.get(node);
        if (change && change.childList)
            return change.oldParentNode ? change.oldParentNode : null;

        var reachabilityChange = this.treeChanges.reachabilityChange(node);
        if (reachabilityChange === 0 /* STAYED_OUT */ || reachabilityChange === 1 /* ENTERED */)
            throw Error('getOldParentNode requested on invalid node.');

        return node.parentNode;
    };

    MutationProjection.prototype.getOldPreviousSibling = function (node) {
        var parentNode = node.parentNode;
        var nodeChange = this.treeChanges.get(node);
        if (nodeChange && nodeChange.oldParentNode)
            parentNode = nodeChange.oldParentNode;

        var change = this.childListChangeMap.get(parentNode);
        if (!change)
            throw Error('getOldPreviousSibling requested on invalid node.');

        return change.oldPrevious.get(node);
    };

    MutationProjection.prototype.getOldAttribute = function (element, attrName) {
        var change = this.treeChanges.get(element);
        if (!change || !change.attributes)
            throw Error('getOldAttribute requested on invalid node.');

        var value = change.getAttributeOldValue(attrName);
        if (value === undefined)
            throw Error('getOldAttribute requested for unchanged attribute name.');

        return value;
    };

    MutationProjection.prototype.attributeChangedNodes = function (includeAttributes) {
        if (!this.treeChanges.anyAttributesChanged)
            return {};

        var attributeFilter;
        var caseInsensitiveFilter;
        if (includeAttributes) {
            attributeFilter = {};
            caseInsensitiveFilter = {};
            for (var i = 0; i < includeAttributes.length; i++) {
                var attrName = includeAttributes[i];
                attributeFilter[attrName] = true;
                caseInsensitiveFilter[attrName.toLowerCase()] = attrName;
            }
        }

        var result = {};
        var nodes = this.treeChanges.keys();

        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];

            var change = this.treeChanges.get(node);
            if (!change.attributes)
                continue;

            if (2 /* STAYED_IN */ !== this.treeChanges.reachabilityChange(node) || 2 /* STAYED_IN */ !== this.matchabilityChange(node)) {
                continue;
            }

            var element = node;
            var changedAttrNames = change.getAttributeNamesMutated();
            for (var j = 0; j < changedAttrNames.length; j++) {
                var attrName = changedAttrNames[j];

                if (attributeFilter && !attributeFilter[attrName] && !(change.isCaseInsensitive && caseInsensitiveFilter[attrName])) {
                    continue;
                }

                var oldValue = change.getAttributeOldValue(attrName);
                if (oldValue === element.getAttribute(attrName))
                    continue;

                if (caseInsensitiveFilter && change.isCaseInsensitive)
                    attrName = caseInsensitiveFilter[attrName];

                result[attrName] = result[attrName] || [];
                result[attrName].push(element);
            }
        }

        return result;
    };

    MutationProjection.prototype.getOldCharacterData = function (node) {
        var change = this.treeChanges.get(node);
        if (!change || !change.characterData)
            throw Error('getOldCharacterData requested on invalid node.');

        return change.characterDataOldValue;
    };

    MutationProjection.prototype.getCharacterDataChanged = function () {
        if (!this.treeChanges.anyCharacterDataChanged)
            return [];

        var nodes = this.treeChanges.keys();
        var result = [];
        for (var i = 0; i < nodes.length; i++) {
            var target = nodes[i];
            if (2 /* STAYED_IN */ !== this.treeChanges.reachabilityChange(target))
                continue;

            var change = this.treeChanges.get(target);
            if (!change.characterData || target.textContent == change.characterDataOldValue)
                continue;

            result.push(target);
        }

        return result;
    };

    MutationProjection.prototype.computeMatchabilityChange = function (selector, el) {
        if (!this.matchCache)
            this.matchCache = [];
        if (!this.matchCache[selector.uid])
            this.matchCache[selector.uid] = new NodeMap();

        var cache = this.matchCache[selector.uid];
        var result = cache.get(el);
        if (result === undefined) {
            result = selector.matchabilityChange(el, this.treeChanges.get(el));
            cache.set(el, result);
        }
        return result;
    };

    MutationProjection.prototype.matchabilityChange = function (node) {
        var _this = this;
        // TODO(rafaelw): Include PI, CDATA?
        // Only include text nodes.
        if (this.characterDataOnly) {
            switch (node.nodeType) {
                case Node.COMMENT_NODE:
                case Node.TEXT_NODE:
                    return 2 /* STAYED_IN */;
                default:
                    return 0 /* STAYED_OUT */;
            }
        }

        // No element filter. Include all nodes.
        if (!this.selectors)
            return 2 /* STAYED_IN */;

        // Element filter. Exclude non-elements.
        if (node.nodeType !== Node.ELEMENT_NODE)
            return 0 /* STAYED_OUT */;

        var el = node;

        var matchChanges = this.selectors.map(function (selector) {
            return _this.computeMatchabilityChange(selector, el);
        });

        var accum = 0 /* STAYED_OUT */;
        var i = 0;

        while (accum !== 2 /* STAYED_IN */ && i < matchChanges.length) {
            switch (matchChanges[i]) {
                case 2 /* STAYED_IN */:
                    accum = 2 /* STAYED_IN */;
                    break;
                case 1 /* ENTERED */:
                    if (accum === 5 /* EXITED */)
                        accum = 2 /* STAYED_IN */;
                    else
                        accum = 1 /* ENTERED */;
                    break;
                case 5 /* EXITED */:
                    if (accum === 1 /* ENTERED */)
                        accum = 2 /* STAYED_IN */;
                    else
                        accum = 5 /* EXITED */;
                    break;
            }

            i++;
        }

        return accum;
    };

    MutationProjection.prototype.getChildlistChange = function (el) {
        var change = this.childListChangeMap.get(el);
        if (!change) {
            change = new ChildListChange();
            this.childListChangeMap.set(el, change);
        }

        return change;
    };

    MutationProjection.prototype.processChildlistChanges = function () {
        if (this.childListChangeMap)
            return;

        this.childListChangeMap = new NodeMap();

        for (var i = 0; i < this.mutations.length; i++) {
            var mutation = this.mutations[i];
            if (mutation.type != 'childList')
                continue;

            if (this.treeChanges.reachabilityChange(mutation.target) !== 2 /* STAYED_IN */ && !this.calcOldPreviousSibling)
                continue;

            var change = this.getChildlistChange(mutation.target);

            var oldPrevious = mutation.previousSibling;

            function recordOldPrevious(node, previous) {
                if (!node || change.oldPrevious.has(node) || change.added.has(node) || change.maybeMoved.has(node))
                    return;

                if (previous && (change.added.has(previous) || change.maybeMoved.has(previous)))
                    return;

                change.oldPrevious.set(node, previous);
            }

            for (var j = 0; j < mutation.removedNodes.length; j++) {
                var node = mutation.removedNodes[j];
                recordOldPrevious(node, oldPrevious);

                if (change.added.has(node)) {
                    change.added.delete(node);
                } else {
                    change.removed.set(node, true);
                    change.maybeMoved.delete(node);
                }

                oldPrevious = node;
            }

            recordOldPrevious(mutation.nextSibling, oldPrevious);

            for (var j = 0; j < mutation.addedNodes.length; j++) {
                var node = mutation.addedNodes[j];
                if (change.removed.has(node)) {
                    change.removed.delete(node);
                    change.maybeMoved.set(node, true);
                } else {
                    change.added.set(node, true);
                }
            }
        }
    };

    MutationProjection.prototype.wasReordered = function (node) {
        if (!this.treeChanges.anyParentsChanged)
            return false;

        this.processChildlistChanges();

        var parentNode = node.parentNode;
        var nodeChange = this.treeChanges.get(node);
        if (nodeChange && nodeChange.oldParentNode)
            parentNode = nodeChange.oldParentNode;

        var change = this.childListChangeMap.get(parentNode);
        if (!change)
            return false;

        if (change.moved)
            return change.moved.get(node);

        change.moved = new NodeMap();
        var pendingMoveDecision = new NodeMap();

        function isMoved(node) {
            if (!node)
                return false;
            if (!change.maybeMoved.has(node))
                return false;

            var didMove = change.moved.get(node);
            if (didMove !== undefined)
                return didMove;

            if (pendingMoveDecision.has(node)) {
                didMove = true;
            } else {
                pendingMoveDecision.set(node, true);
                didMove = getPrevious(node) !== getOldPrevious(node);
            }

            if (pendingMoveDecision.has(node)) {
                pendingMoveDecision.delete(node);
                change.moved.set(node, didMove);
            } else {
                didMove = change.moved.get(node);
            }

            return didMove;
        }

        var oldPreviousCache = new NodeMap();
        function getOldPrevious(node) {
            var oldPrevious = oldPreviousCache.get(node);
            if (oldPrevious !== undefined)
                return oldPrevious;

            oldPrevious = change.oldPrevious.get(node);
            while (oldPrevious && (change.removed.has(oldPrevious) || isMoved(oldPrevious))) {
                oldPrevious = getOldPrevious(oldPrevious);
            }

            if (oldPrevious === undefined)
                oldPrevious = node.previousSibling;
            oldPreviousCache.set(node, oldPrevious);

            return oldPrevious;
        }

        var previousCache = new NodeMap();
        function getPrevious(node) {
            if (previousCache.has(node))
                return previousCache.get(node);

            var previous = node.previousSibling;
            while (previous && (change.added.has(previous) || isMoved(previous)))
                previous = previous.previousSibling;

            previousCache.set(node, previous);
            return previous;
        }

        change.maybeMoved.keys().forEach(isMoved);
        return change.moved.get(node);
    };
    return MutationProjection;
})();

var Summary = (function () {
    function Summary(projection, query) {
        var _this = this;
        this.projection = projection;
        this.added = [];
        this.removed = [];
        this.reparented = query.all || query.element ? [] : undefined;
        this.reordered = query.all ? [] : undefined;

        projection.getChanged(this, query.elementFilter, query.characterData);

        if (query.all || query.attribute || query.attributeList) {
            var filter = query.attribute ? [query.attribute] : query.attributeList;
            var attributeChanged = projection.attributeChangedNodes(filter);

            if (query.attribute) {
                this.valueChanged = attributeChanged[query.attribute] || [];
            } else {
                this.attributeChanged = attributeChanged;
                if (query.attributeList) {
                    query.attributeList.forEach(function (attrName) {
                        if (!_this.attributeChanged.hasOwnProperty(attrName))
                            _this.attributeChanged[attrName] = [];
                    });
                }
            }
        }

        if (query.all || query.characterData) {
            var characterDataChanged = projection.getCharacterDataChanged();

            if (query.characterData)
                this.valueChanged = characterDataChanged;
            else
                this.characterDataChanged = characterDataChanged;
        }

        if (this.reordered)
            this.getOldPreviousSibling = projection.getOldPreviousSibling.bind(projection);
    }
    Summary.prototype.getOldParentNode = function (node) {
        return this.projection.getOldParentNode(node);
    };

    Summary.prototype.getOldAttribute = function (node, name) {
        return this.projection.getOldAttribute(node, name);
    };

    Summary.prototype.getOldCharacterData = function (node) {
        return this.projection.getOldCharacterData(node);
    };

    Summary.prototype.getOldPreviousSibling = function (node) {
        return this.projection.getOldPreviousSibling(node);
    };
    return Summary;
})();

// TODO(rafaelw): Allow ':' and '.' as valid name characters.
var validNameInitialChar = /[a-zA-Z_]+/;
var validNameNonInitialChar = /[a-zA-Z0-9_\-]+/;

// TODO(rafaelw): Consider allowing backslash in the attrValue.
// TODO(rafaelw): There's got a to be way to represent this state machine
// more compactly???
function escapeQuotes(value) {
    return '"' + value.replace(/"/, '\\\"') + '"';
}

var Qualifier = (function () {
    function Qualifier() {
    }
    Qualifier.prototype.matches = function (oldValue) {
        if (oldValue === null)
            return false;

        if (this.attrValue === undefined)
            return true;

        if (!this.contains)
            return this.attrValue == oldValue;

        var tokens = oldValue.split(' ');
        for (var i = 0; i < tokens.length; i++) {
            if (this.attrValue === tokens[i])
                return true;
        }

        return false;
    };

    Qualifier.prototype.toString = function () {
        if (this.attrName === 'class' && this.contains)
            return '.' + this.attrValue;

        if (this.attrName === 'id' && !this.contains)
            return '#' + this.attrValue;

        if (this.contains)
            return '[' + this.attrName + '~=' + escapeQuotes(this.attrValue) + ']';

        if ('attrValue' in this)
            return '[' + this.attrName + '=' + escapeQuotes(this.attrValue) + ']';

        return '[' + this.attrName + ']';
    };
    return Qualifier;
})();

var Selector = (function () {
    function Selector() {
        this.uid = Selector.nextUid++;
        this.qualifiers = [];
    }
    Object.defineProperty(Selector.prototype, "caseInsensitiveTagName", {
        get: function () {
            return this.tagName.toUpperCase();
        },
        enumerable: true,
        configurable: true
    });

    Object.defineProperty(Selector.prototype, "selectorString", {
        get: function () {
            return this.tagName + this.qualifiers.join('');
        },
        enumerable: true,
        configurable: true
    });

    Selector.prototype.isMatching = function (el) {
        return el[Selector.matchesSelector](this.selectorString);
    };

    Selector.prototype.wasMatching = function (el, change, isMatching) {
        if (!change || !change.attributes)
            return isMatching;

        var tagName = change.isCaseInsensitive ? this.caseInsensitiveTagName : this.tagName;
        if (tagName !== '*' && tagName !== el.tagName)
            return false;

        var attributeOldValues = [];
        var anyChanged = false;
        for (var i = 0; i < this.qualifiers.length; i++) {
            var qualifier = this.qualifiers[i];
            var oldValue = change.getAttributeOldValue(qualifier.attrName);
            attributeOldValues.push(oldValue);
            anyChanged = anyChanged || (oldValue !== undefined);
        }

        if (!anyChanged)
            return isMatching;

        for (var i = 0; i < this.qualifiers.length; i++) {
            var qualifier = this.qualifiers[i];
            var oldValue = attributeOldValues[i];
            if (oldValue === undefined)
                oldValue = el.getAttribute(qualifier.attrName);
            if (!qualifier.matches(oldValue))
                return false;
        }

        return true;
    };

    Selector.prototype.matchabilityChange = function (el, change) {
        var isMatching = this.isMatching(el);
        if (isMatching)
            return this.wasMatching(el, change, isMatching) ? 2 /* STAYED_IN */ : 1 /* ENTERED */;
        else
            return this.wasMatching(el, change, isMatching) ? 5 /* EXITED */ : 0 /* STAYED_OUT */;
    };

    Selector.parseSelectors = function (input) {
        var selectors = [];
        var currentSelector;
        var currentQualifier;

        function newSelector() {
            if (currentSelector) {
                if (currentQualifier) {
                    currentSelector.qualifiers.push(currentQualifier);
                    currentQualifier = undefined;
                }

                selectors.push(currentSelector);
            }
            currentSelector = new Selector();
        }

        function newQualifier() {
            if (currentQualifier)
                currentSelector.qualifiers.push(currentQualifier);

            currentQualifier = new Qualifier();
        }

        var WHITESPACE = /\s/;
        var valueQuoteChar;
        var SYNTAX_ERROR = 'Invalid or unsupported selector syntax.';

        var SELECTOR = 1;
        var TAG_NAME = 2;
        var QUALIFIER = 3;
        var QUALIFIER_NAME_FIRST_CHAR = 4;
        var QUALIFIER_NAME = 5;
        var ATTR_NAME_FIRST_CHAR = 6;
        var ATTR_NAME = 7;
        var EQUIV_OR_ATTR_QUAL_END = 8;
        var EQUAL = 9;
        var ATTR_QUAL_END = 10;
        var VALUE_FIRST_CHAR = 11;
        var VALUE = 12;
        var QUOTED_VALUE = 13;
        var SELECTOR_SEPARATOR = 14;

        var state = SELECTOR;
        var i = 0;
        while (i < input.length) {
            var c = input[i++];

            switch (state) {
                case SELECTOR:
                    if (c.match(validNameInitialChar)) {
                        newSelector();
                        currentSelector.tagName = c;
                        state = TAG_NAME;
                        break;
                    }

                    if (c == '*') {
                        newSelector();
                        currentSelector.tagName = '*';
                        state = QUALIFIER;
                        break;
                    }

                    if (c == '.') {
                        newSelector();
                        newQualifier();
                        currentSelector.tagName = '*';
                        currentQualifier.attrName = 'class';
                        currentQualifier.contains = true;
                        state = QUALIFIER_NAME_FIRST_CHAR;
                        break;
                    }
                    if (c == '#') {
                        newSelector();
                        newQualifier();
                        currentSelector.tagName = '*';
                        currentQualifier.attrName = 'id';
                        state = QUALIFIER_NAME_FIRST_CHAR;
                        break;
                    }
                    if (c == '[') {
                        newSelector();
                        newQualifier();
                        currentSelector.tagName = '*';
                        currentQualifier.attrName = '';
                        state = ATTR_NAME_FIRST_CHAR;
                        break;
                    }

                    if (c.match(WHITESPACE))
                        break;

                    throw Error(SYNTAX_ERROR);

                case TAG_NAME:
                    if (c.match(validNameNonInitialChar)) {
                        currentSelector.tagName += c;
                        break;
                    }

                    if (c == '.') {
                        newQualifier();
                        currentQualifier.attrName = 'class';
                        currentQualifier.contains = true;
                        state = QUALIFIER_NAME_FIRST_CHAR;
                        break;
                    }
                    if (c == '#') {
                        newQualifier();
                        currentQualifier.attrName = 'id';
                        state = QUALIFIER_NAME_FIRST_CHAR;
                        break;
                    }
                    if (c == '[') {
                        newQualifier();
                        currentQualifier.attrName = '';
                        state = ATTR_NAME_FIRST_CHAR;
                        break;
                    }

                    if (c.match(WHITESPACE)) {
                        state = SELECTOR_SEPARATOR;
                        break;
                    }

                    if (c == ',') {
                        state = SELECTOR;
                        break;
                    }

                    throw Error(SYNTAX_ERROR);

                case QUALIFIER:
                    if (c == '.') {
                        newQualifier();
                        currentQualifier.attrName = 'class';
                        currentQualifier.contains = true;
                        state = QUALIFIER_NAME_FIRST_CHAR;
                        break;
                    }
                    if (c == '#') {
                        newQualifier();
                        currentQualifier.attrName = 'id';
                        state = QUALIFIER_NAME_FIRST_CHAR;
                        break;
                    }
                    if (c == '[') {
                        newQualifier();
                        currentQualifier.attrName = '';
                        state = ATTR_NAME_FIRST_CHAR;
                        break;
                    }

                    if (c.match(WHITESPACE)) {
                        state = SELECTOR_SEPARATOR;
                        break;
                    }

                    if (c == ',') {
                        state = SELECTOR;
                        break;
                    }

                    throw Error(SYNTAX_ERROR);

                case QUALIFIER_NAME_FIRST_CHAR:
                    if (c.match(validNameInitialChar)) {
                        currentQualifier.attrValue = c;
                        state = QUALIFIER_NAME;
                        break;
                    }

                    throw Error(SYNTAX_ERROR);

                case QUALIFIER_NAME:
                    if (c.match(validNameNonInitialChar)) {
                        currentQualifier.attrValue += c;
                        break;
                    }

                    if (c == '.') {
                        newQualifier();
                        currentQualifier.attrName = 'class';
                        currentQualifier.contains = true;
                        state = QUALIFIER_NAME_FIRST_CHAR;
                        break;
                    }
                    if (c == '#') {
                        newQualifier();
                        currentQualifier.attrName = 'id';
                        state = QUALIFIER_NAME_FIRST_CHAR;
                        break;
                    }
                    if (c == '[') {
                        newQualifier();
                        state = ATTR_NAME_FIRST_CHAR;
                        break;
                    }

                    if (c.match(WHITESPACE)) {
                        state = SELECTOR_SEPARATOR;
                        break;
                    }
                    if (c == ',') {
                        state = SELECTOR;
                        break;
                    }

                    throw Error(SYNTAX_ERROR);

                case ATTR_NAME_FIRST_CHAR:
                    if (c.match(validNameInitialChar)) {
                        currentQualifier.attrName = c;
                        state = ATTR_NAME;
                        break;
                    }

                    if (c.match(WHITESPACE))
                        break;

                    throw Error(SYNTAX_ERROR);

                case ATTR_NAME:
                    if (c.match(validNameNonInitialChar)) {
                        currentQualifier.attrName += c;
                        break;
                    }

                    if (c.match(WHITESPACE)) {
                        state = EQUIV_OR_ATTR_QUAL_END;
                        break;
                    }

                    if (c == '~') {
                        currentQualifier.contains = true;
                        state = EQUAL;
                        break;
                    }

                    if (c == '=') {
                        currentQualifier.attrValue = '';
                        state = VALUE_FIRST_CHAR;
                        break;
                    }

                    if (c == ']') {
                        state = QUALIFIER;
                        break;
                    }

                    throw Error(SYNTAX_ERROR);

                case EQUIV_OR_ATTR_QUAL_END:
                    if (c == '~') {
                        currentQualifier.contains = true;
                        state = EQUAL;
                        break;
                    }

                    if (c == '=') {
                        currentQualifier.attrValue = '';
                        state = VALUE_FIRST_CHAR;
                        break;
                    }

                    if (c == ']') {
                        state = QUALIFIER;
                        break;
                    }

                    if (c.match(WHITESPACE))
                        break;

                    throw Error(SYNTAX_ERROR);

                case EQUAL:
                    if (c == '=') {
                        currentQualifier.attrValue = '';
                        state = VALUE_FIRST_CHAR;
                        break;
                    }

                    throw Error(SYNTAX_ERROR);

                case ATTR_QUAL_END:
                    if (c == ']') {
                        state = QUALIFIER;
                        break;
                    }

                    if (c.match(WHITESPACE))
                        break;

                    throw Error(SYNTAX_ERROR);

                case VALUE_FIRST_CHAR:
                    if (c.match(WHITESPACE))
                        break;

                    if (c == '"' || c == "'") {
                        valueQuoteChar = c;
                        state = QUOTED_VALUE;
                        break;
                    }

                    currentQualifier.attrValue += c;
                    state = VALUE;
                    break;

                case VALUE:
                    if (c.match(WHITESPACE)) {
                        state = ATTR_QUAL_END;
                        break;
                    }
                    if (c == ']') {
                        state = QUALIFIER;
                        break;
                    }
                    if (c == "'" || c == '"')
                        throw Error(SYNTAX_ERROR);

                    currentQualifier.attrValue += c;
                    break;

                case QUOTED_VALUE:
                    if (c == valueQuoteChar) {
                        state = ATTR_QUAL_END;
                        break;
                    }

                    currentQualifier.attrValue += c;
                    break;

                case SELECTOR_SEPARATOR:
                    if (c.match(WHITESPACE))
                        break;

                    if (c == ',') {
                        state = SELECTOR;
                        break;
                    }

                    throw Error(SYNTAX_ERROR);
            }
        }

        switch (state) {
            case SELECTOR:
            case TAG_NAME:
            case QUALIFIER:
            case QUALIFIER_NAME:
            case SELECTOR_SEPARATOR:
                // Valid end states.
                newSelector();
                break;
            default:
                throw Error(SYNTAX_ERROR);
        }

        if (!selectors.length)
            throw Error(SYNTAX_ERROR);

        return selectors;
    };
    Selector.nextUid = 1;
    Selector.matchesSelector = (function () {
        var element = document.createElement('div');
        if (typeof element['webkitMatchesSelector'] === 'function')
            return 'webkitMatchesSelector';
        if (typeof element['mozMatchesSelector'] === 'function')
            return 'mozMatchesSelector';
        if (typeof element['msMatchesSelector'] === 'function')
            return 'msMatchesSelector';

        return 'matchesSelector';
    })();
    return Selector;
})();

var attributeFilterPattern = /^([a-zA-Z:_]+[a-zA-Z0-9_\-:\.]*)$/;

function validateAttribute(attribute) {
    if (typeof attribute != 'string')
        throw Error('Invalid request opion. attribute must be a non-zero length string.');

    attribute = attribute.trim();

    if (!attribute)
        throw Error('Invalid request opion. attribute must be a non-zero length string.');

    if (!attribute.match(attributeFilterPattern))
        throw Error('Invalid request option. invalid attribute name: ' + attribute);

    return attribute;
}

function validateElementAttributes(attribs) {
    if (!attribs.trim().length)
        throw Error('Invalid request option: elementAttributes must contain at least one attribute.');

    var lowerAttributes = {};
    var attributes = {};

    var tokens = attribs.split(/\s+/);
    for (var i = 0; i < tokens.length; i++) {
        var name = tokens[i];
        if (!name)
            continue;

        var name = validateAttribute(name);
        var nameLower = name.toLowerCase();
        if (lowerAttributes[nameLower])
            throw Error('Invalid request option: observing multiple case variations of the same attribute is not supported.');

        attributes[name] = true;
        lowerAttributes[nameLower] = true;
    }

    return Object.keys(attributes);
}

function elementFilterAttributes(selectors) {
    var attributes = {};

    selectors.forEach(function (selector) {
        selector.qualifiers.forEach(function (qualifier) {
            attributes[qualifier.attrName] = true;
        });
    });

    return Object.keys(attributes);
}

var MutationSummary = (function () {
    function MutationSummary(opts) {
        var _this = this;
        this.connected = false;
        this.options = MutationSummary.validateOptions(opts);
        this.observerOptions = MutationSummary.createObserverOptions(this.options.queries);
        this.root = this.options.rootNode;
        this.callback = this.options.callback;

        this.elementFilter = Array.prototype.concat.apply([], this.options.queries.map(function (query) {
            return query.elementFilter ? query.elementFilter : [];
        }));
        if (!this.elementFilter.length)
            this.elementFilter = undefined;

        this.calcReordered = this.options.queries.some(function (query) {
            return query.all;
        });

        this.queryValidators = []; // TODO(rafaelw): Shouldn't always define this.
        if (MutationSummary.createQueryValidator) {
            this.queryValidators = this.options.queries.map(function (query) {
                return MutationSummary.createQueryValidator(_this.root, query);
            });
        }

        this.observer = new MutationObserverCtor(function (mutations) {
            _this.observerCallback(mutations);
        });

        this.reconnect();
    }
    MutationSummary.createObserverOptions = function (queries) {
        var observerOptions = {
            childList: true,
            subtree: true
        };

        var attributeFilter;
        function observeAttributes(attributes) {
            if (observerOptions.attributes && !attributeFilter)
                return;

            observerOptions.attributes = true;
            observerOptions.attributeOldValue = true;

            if (!attributes) {
                // observe all.
                attributeFilter = undefined;
                return;
            }

            // add to observed.
            attributeFilter = attributeFilter || {};
            attributes.forEach(function (attribute) {
                attributeFilter[attribute] = true;
                attributeFilter[attribute.toLowerCase()] = true;
            });
        }

        queries.forEach(function (query) {
            if (query.characterData) {
                observerOptions.characterData = true;
                observerOptions.characterDataOldValue = true;
                return;
            }

            if (query.all) {
                observeAttributes();
                observerOptions.characterData = true;
                observerOptions.characterDataOldValue = true;
                return;
            }

            if (query.attribute) {
                observeAttributes([query.attribute.trim()]);
                return;
            }

            var attributes = elementFilterAttributes(query.elementFilter).concat(query.attributeList || []);
            if (attributes.length)
                observeAttributes(attributes);
        });

        if (attributeFilter)
            observerOptions.attributeFilter = Object.keys(attributeFilter);

        return observerOptions;
    };

    MutationSummary.validateOptions = function (options) {
        for (var prop in options) {
            if (!(prop in MutationSummary.optionKeys))
                throw Error('Invalid option: ' + prop);
        }

        if (typeof options.callback !== 'function')
            throw Error('Invalid options: callback is required and must be a function');

        if (!options.queries || !options.queries.length)
            throw Error('Invalid options: queries must contain at least one query request object.');

        var opts = {
            callback: options.callback,
            rootNode: options.rootNode || document,
            observeOwnChanges: !!options.observeOwnChanges,
            oldPreviousSibling: !!options.oldPreviousSibling,
            queries: []
        };

        for (var i = 0; i < options.queries.length; i++) {
            var request = options.queries[i];

            // all
            if (request.all) {
                if (Object.keys(request).length > 1)
                    throw Error('Invalid request option. all has no options.');

                opts.queries.push({ all: true });
                continue;
            }

            // attribute
            if ('attribute' in request) {
                var query = {
                    attribute: validateAttribute(request.attribute)
                };

                query.elementFilter = Selector.parseSelectors('*[' + query.attribute + ']');

                if (Object.keys(request).length > 1)
                    throw Error('Invalid request option. attribute has no options.');

                opts.queries.push(query);
                continue;
            }

            // element
            if ('element' in request) {
                var requestOptionCount = Object.keys(request).length;
                var query = {
                    element: request.element,
                    elementFilter: Selector.parseSelectors(request.element)
                };

                if (request.hasOwnProperty('elementAttributes')) {
                    query.attributeList = validateElementAttributes(request.elementAttributes);
                    requestOptionCount--;
                }

                if (requestOptionCount > 1)
                    throw Error('Invalid request option. element only allows elementAttributes option.');

                opts.queries.push(query);
                continue;
            }

            // characterData
            if (request.characterData) {
                if (Object.keys(request).length > 1)
                    throw Error('Invalid request option. characterData has no options.');

                opts.queries.push({ characterData: true });
                continue;
            }

            throw Error('Invalid request option. Unknown query request.');
        }

        return opts;
    };

    MutationSummary.prototype.createSummaries = function (mutations) {
        if (!mutations || !mutations.length)
            return [];

        var projection = new MutationProjection(this.root, mutations, this.elementFilter, this.calcReordered, this.options.oldPreviousSibling);

        var summaries = [];
        for (var i = 0; i < this.options.queries.length; i++) {
            summaries.push(new Summary(projection, this.options.queries[i]));
        }

        return summaries;
    };

    MutationSummary.prototype.checkpointQueryValidators = function () {
        this.queryValidators.forEach(function (validator) {
            if (validator)
                validator.recordPreviousState();
        });
    };

    MutationSummary.prototype.runQueryValidators = function (summaries) {
        this.queryValidators.forEach(function (validator, index) {
            if (validator)
                validator.validate(summaries[index]);
        });
    };

    MutationSummary.prototype.changesToReport = function (summaries) {
        return summaries.some(function (summary) {
            var summaryProps = [
                'added', 'removed', 'reordered', 'reparented',
                'valueChanged', 'characterDataChanged'];
            if (summaryProps.some(function (prop) {
                return summary[prop] && summary[prop].length;
            }))
                return true;

            if (summary.attributeChanged) {
                var attrNames = Object.keys(summary.attributeChanged);
                var attrsChanged = attrNames.some(function (attrName) {
                    return !!summary.attributeChanged[attrName].length;
                });
                if (attrsChanged)
                    return true;
            }
            return false;
        });
    };

    MutationSummary.prototype.observerCallback = function (mutations) {
        if (!this.options.observeOwnChanges)
            this.observer.disconnect();

        var summaries = this.createSummaries(mutations);
        this.runQueryValidators(summaries);

        if (this.options.observeOwnChanges)
            this.checkpointQueryValidators();

        if (this.changesToReport(summaries))
            this.callback(summaries);

        // disconnect() may have been called during the callback.
        if (!this.options.observeOwnChanges && this.connected) {
            this.checkpointQueryValidators();
            this.observer.observe(this.root, this.observerOptions);
        }
    };

    MutationSummary.prototype.reconnect = function () {
        if (this.connected)
            throw Error('Already connected');

        this.observer.observe(this.root, this.observerOptions);
        this.connected = true;
        this.checkpointQueryValidators();
    };

    MutationSummary.prototype.takeSummaries = function () {
        if (!this.connected)
            throw Error('Not connected');

        var summaries = this.createSummaries(this.observer.takeRecords());
        return this.changesToReport(summaries) ? summaries : undefined;
    };

    MutationSummary.prototype.disconnect = function () {
        var summaries = this.takeSummaries();
        this.observer.disconnect();
        this.connected = false;
        return summaries;
    };
    MutationSummary.NodeMap = NodeMap;
    MutationSummary.NodeIdMap = NodeIdMap;
    MutationSummary.parseElementFilter = Selector.parseSelectors;

    MutationSummary.optionKeys = {
        'callback': true,
        'queries': true,
        'rootNode': true,
        'oldPreviousSibling': true,
        'observeOwnChanges': true
    };
    return MutationSummary;
})();


///<reference path='../src/mutation-summary.ts'/>

var TreeMirror = (function () {
    function TreeMirror(root, delegate) {
        this.root = root;
        this.delegate = delegate;
        this.idMap = {};
    }
    TreeMirror.prototype.initialize = function (rootId, children, baseURI) {
        this.baseURI = baseURI;
        this.idMap[rootId] = this.root;

        for (var i = 0; i < children.length; i++)
            this.deserializeNode(children[i], this.root);
    };

    TreeMirror.prototype.applyChanged = function (removed, addedOrMoved, attributes, text) {
        var _this = this;
        // NOTE: Applying the changes can result in an attempting to add a child
        // to a parent which is presently an ancestor of the parent. This can occur
        // based on random ordering of moves. The way we handle this is to first
        // remove all changed nodes from their parents, then apply.
        addedOrMoved.forEach(function (data) {
            var node = _this.deserializeNode(data);
            var parent = _this.deserializeNode(data.parentNode);
            var previous = _this.deserializeNode(data.previousSibling);
            if (node.parentNode)
                node.parentNode.removeChild(node);
        });

        removed.forEach(function (data) {
            var node = _this.deserializeNode(data);
            if (node.parentNode)
                node.parentNode.removeChild(node);
        });

        addedOrMoved.forEach(function (data) {
            var node = _this.deserializeNode(data);
            var parent = _this.deserializeNode(data.parentNode);
            var previous = _this.deserializeNode(data.previousSibling);
            parent.insertBefore(node, previous ? previous.nextSibling : parent.firstChild);
        });

        attributes.forEach(function (data) {
            var node = _this.deserializeNode(data);
            Object.keys(data.attributes).forEach(function (attrName) {
                var newVal = data.attributes[attrName];
                if (newVal === null) {
                    node.removeAttribute(attrName);
                } else {
                    if (!_this.delegate || !_this.delegate.setAttribute || !_this.delegate.setAttribute(node, attrName, newVal)) {
                        node.setAttribute(attrName, newVal);
                    }
                }
            });
        });

        text.forEach(function (data) {
            var node = _this.deserializeNode(data);
            node.textContent = data.textContent;
        });

        removed.forEach(function (node) {
            delete _this.idMap[node.id];
        });
    };

    TreeMirror.prototype.deserializeNode = function (nodeData, parent) {
        var _this = this;
        if (nodeData === null)
            return null;

        var node = this.idMap[nodeData.id];
        if (node)
            return node;

        var doc = this.root.ownerDocument;
        if (doc === null)
            doc = this.root;

        switch (nodeData.nodeType) {
            case Node.COMMENT_NODE:
                node = doc.createComment(nodeData.textContent);
                break;

            case Node.TEXT_NODE:
                node = doc.createTextNode(nodeData.textContent);
                break;

            case Node.DOCUMENT_TYPE_NODE:
                try {
                    node = doc.implementation.createDocumentType(nodeData.name, nodeData.publicId, nodeData.systemId);
                } catch (e) {
                    // Ignore error from incorrect document type
                }
                break;

            case Node.ELEMENT_NODE:
                if (this.delegate && this.delegate.createElement)
                    node = this.delegate.createElement(nodeData.tagName);
                if (!node)
                    node = doc.createElement(nodeData.tagName);
                node.setAttribute('data-tagid', nodeData.id);

                Object.keys(nodeData.attributes).forEach(function (name) {
                    if (!_this.delegate || !_this.delegate.setAttribute || !_this.delegate.setAttribute(node, name, nodeData.attributes[name])) {
                        node.setAttribute(name, nodeData.attributes[name]);
                    }
                });

                break;
        }

        if (!node) {
            throw new Error("No node with that id.");
        }

        this.idMap[nodeData.id] = node;
        node.nodeid = nodeData.id;

        if (parent)
            parent.appendChild(node);

        if (nodeData.childNodes) {
            for (var i = 0; i < nodeData.childNodes.length; i++)
                this.deserializeNode(nodeData.childNodes[i], node);
        }

        return node;
    };
    return TreeMirror;
})();

var URL_ATTRIBUTES = {
    img_src: true,
    link_href: true,
    input_src: true,
    body_background: true,
    table_background: true,
    td_background: true,
    tr_background: true,
    th_background: true,
    tbody_background: true,
    thead_background: true,
    tfoot_background: true,
    col_background: true,
    colgroup_background: true,
    section_background: true,
    head_profile: true,
    html_manifest: true,
    command_icon: true,
    embed_src: true,
    object_data: true,
    video_poster: true,
    form_action: true,
    iframe_src: true
};
function isUrlAttribute(tagName, attribute) {
    var key = tagName.toLowerCase() + '_' + attribute.toLowerCase();
    return URL_ATTRIBUTES[key] || false;
}

var TreeMirrorClient = (function () {
    function TreeMirrorClient(target, mirror, testingQueries) {
        var _this = this;
        this.target = target;
        this.mirror = mirror;
        this.nextId = 1;
        this.knownNodes = new MutationSummary.NodeIdMap();
        //this.knownNodes = new MutationSummary.NodeMap();

        var rootId = this.serializeNode(target).id;
        var children = [];
        for (var child = target.firstChild; child; child = child.nextSibling)
            children.push(this.serializeNode(child, true));

        this.mirror.initialize(rootId, children, target.baseURI);

        var self = this;

        var queries = [{ all: true }];

        if (testingQueries)
            queries = queries.concat(testingQueries);

        this.mutationSummary = new MutationSummary({
            rootNode: target,
            callback: function (summaries) {
                try {
                    _this.applyChanged(summaries);
                } catch (e) {
                    if (e.message !== 'No node with that id') {
                        throw e;
                    }
                }
            },
            queries: queries
        });
    }
    TreeMirrorClient.prototype.disconnect = function () {
        if (this.mutationSummary) {
            this.mutationSummary.disconnect();
            this.mutationSummary = undefined;
        }
    };

    TreeMirrorClient.prototype.rememberNode = function (node) {
        var id = this.nextId++;
        this.knownNodes.set(node, id);
        return id;
    };

    TreeMirrorClient.prototype.forgetNode = function (node) {
        this.knownNodes.delete(node);
    };

    TreeMirrorClient.prototype.serializeAttribute = function (node, attr, obj) {
        var value = node.getAttribute(attr);
        var tagName = node.tagName;

        if(value === null) {
            obj[attr] = null; // Attribute was removed
            obj['data-portia-' + attr] = null;
        } else if(attr === "style"){
            obj[attr] = __portiaApi.processCss(value, node.baseURI);
            obj['data-portia-' + attr] = value;
        } else if (attr === 'srcset' && tagName === 'IMG') {
            var split_attr = value.split(',')
            for (var i=0; i < split_attr.length; i++) {
                split_attr[i] = __portiaApi.wrapUrl(
                    split_attr[i].trim(),
                    node.baseURI);
            }
            obj[attr] = split_attr.join(', ')
            obj['data-portia-' + attr] = value;
        } else if (isUrlAttribute(tagName, attr)){
            obj[attr] = __portiaApi.wrapUrl(value, node.baseURI);
            obj['data-portia-' + attr] = value;
        } else if (tagName === 'A' && attr === 'href') {
            value = node.href;
            if(!value || /^\s*javascript:/i.test(value)){
                obj[attr] = 'javascript:void(0)';
                obj['data-portia-' + attr] = value;
            } else {
                obj[attr] = value;
            }
        } else {
            obj[attr] = value;
        }
    };

    TreeMirrorClient.prototype.serializeNode = function (node, recursive) {
        if (node === null)
            return null;

        var id = this.knownNodes.get(node);
        if (id !== undefined) {
            return { id: id };
        }

        var data = {
            nodeType: node.nodeType,
            id: this.rememberNode(node)
        };


        switch (data.nodeType) {
            case Node.DOCUMENT_TYPE_NODE:
                var docType = node;
                data.name = docType.name;
                data.publicId = docType.publicId;
                data.systemId = docType.systemId;
                break;

            case Node.COMMENT_NODE:
            case Node.TEXT_NODE:
                data.textContent = node.textContent;
                if(node.parentNode && node.parentNode.tagName == "STYLE"){
                    data.textContent = __portiaApi.processCss(data.textContent, node.baseURI);
                }
                break;

            case Node.ELEMENT_NODE:
                var elm = node;
                data.tagName = elm.tagName;
                data.attributes = {};
                for (var i = 0; i < elm.attributes.length; i++) {
                    var attr = elm.attributes[i];
                    this.serializeAttribute(node, attr.name, data.attributes);
                }

                if (recursive && elm.childNodes.length) {
                    data.childNodes = [];

                    for (var child = elm.firstChild; child; child = child.nextSibling)
                        data.childNodes.push(this.serializeNode(child, true));
                }
                break;
        }

        return data;
    };

    TreeMirrorClient.prototype.serializeAddedAndMoved = function (added, reparented, reordered) {
        var _this = this;
        var all = added.concat(reparented).concat(reordered);

        var parentMap = new MutationSummary.NodeMap();

        all.forEach(function (node) {
            var parent = node.parentNode;
            var children = parentMap.get(parent);
            if (!children) {
                children = new MutationSummary.NodeMap();
                parentMap.set(parent, children);
            }

            children.set(node, true);
        });

        var moved = [];

        parentMap.keys().forEach(function (parent) {
            var children = parentMap.get(parent);

            var keys = children.keys();
            while (keys.length) {
                var node = keys[0];
                while (node.previousSibling && children.has(node.previousSibling))
                    node = node.previousSibling;

                while (node && children.has(node)) {
                    var data = _this.serializeNode(node);
                    data.previousSibling = _this.serializeNode(node.previousSibling);
                    data.parentNode = _this.serializeNode(node.parentNode);
                    moved.push(data);
                    children.delete(node);
                    node = node.nextSibling;
                }

                var keys = children.keys();
            }
        });

        return moved;
    };

    TreeMirrorClient.prototype.serializeAttributeChanges = function (attributeChanged) {
        var _this = this;
        var map = new MutationSummary.NodeMap();

        Object.keys(attributeChanged).forEach(function (attrName) {
            (attributeChanged[attrName] || []).forEach(function (element) {
                var record = map.get(element);
                if (!record) {
                    record = _this.serializeNode(element);
                    record.attributes = {};
                    map.set(element, record);
                }

                _this.serializeAttribute(element, attrName, record.attributes);
            });
        });

        return map.keys().map(function (node) {
            return map.get(node);
        });
    };

    TreeMirrorClient.prototype.applyChanged = function (summaries) {
        var _this = this;
        var summary = summaries[0];

        var removed = summary.removed.map(function (node) {
            return _this.serializeNode(node);
        });

        var moved = this.serializeAddedAndMoved(summary.added, summary.reparented, summary.reordered);

        var attributes = this.serializeAttributeChanges(summary.attributeChanged);

        var text = summary.characterDataChanged.map(function (node) {
            var data = _this.serializeNode(node);
            data.textContent = node.textContent;
            return data;
        });

        this.mirror.applyChanged(removed, moved, attributes, text);

        summary.removed.forEach(function (node) {
            _this.forgetNode(node);
        });
    };
    return TreeMirrorClient;
})();

// Keep a reference to some native methods, so we use the originals if
// they are overridden by the page
var Json = JSON;
var JSONstringify = JSON.stringify;
var arraySplice = Array.prototype.splice;
var ArrayProto = Array.prototype;
var ObjectProto = Object.prototype;
var NumberProto = Number.prototype;
var StringProto = String.prototype;
var BooleanProto = Boolean.prototype;


// Note: Variables here are not leaked to the global scope because the compiler wraps it in a function

var MAX_DIALOGS = 15;  // Maximum number of dialogs (alert, confirm, prompt) before throwing an exception

var PortiaPage = function PortiaPage() {
    var that = this;
    this.mirrorClient = new TreeMirrorClient(document, {
        initialize: function(rootId, children, baseURI){
            that.sendMessage('mutation', ['initialize', rootId, children, baseURI]);
        },
        applyChanged: function(removed, addedOrMoved, attributes, text){
            that.sendMessage('mutation', ['applyChanged', removed, addedOrMoved, attributes, text]);
        }
    });
};

PortiaPage.prototype.sendMutation = function(){
    this.sendMessage('mutation', arraySplice.call(arguments, 0));
};

PortiaPage.prototype.sendMessage = function(action, message) {
    var oldAPtoJson = ArrayProto.toJSON;
    var oldOPtoJson = ObjectProto.toJSON;
    var oldNPtoJson = NumberProto.toJSON;
    var oldSPtoJson = StringProto.toJSON;
    var oldBPtoJson = BooleanProto.toJSON;
    delete ArrayProto.toJSON;
    delete ObjectProto.toJSON;
    delete NumberProto.toJSON;
    delete StringProto.toJSON;
    delete BooleanProto.toJSON;

    __portiaApi.sendMessage(JSONstringify.call(Json, [action, message]));

    if(oldAPtoJson) { ArrayProto.toJSON   = oldAPtoJson; }
    if(oldOPtoJson) { ObjectProto.toJSON  = oldOPtoJson; }
    if(oldNPtoJson) { NumberProto.toJSON  = oldNPtoJson; }
    if(oldSPtoJson) { StringProto.toJSON  = oldSPtoJson; }
    if(oldBPtoJson) { BooleanProto.toJSON = oldBPtoJson; }
};

PortiaPage.prototype.url = function() {
    return window.location;
};

PortiaPage.prototype.scrollX = function() {
    return window.scrollX;
};

PortiaPage.prototype.scrollY = function() {
    return window.scrollY;
};

PortiaPage.prototype.screenX = function() {
    return window.screenX;
};

PortiaPage.prototype.screenY = function() {
    return window.screenY;
};

PortiaPage.prototype.currentState = function() {
    return {
        url: this.url,
        scroll: {
            x: this.scrollX(),
            y: this.scrollY(),
            v: this.screenX(),
            h: this.screenY(),
            mx: window.scrollMaxX,
            my: window.scrollMaxY
        }
    };
};

PortiaPage.sendEvent = {};

PortiaPage.sendEvent.keyboard = function(element, data, type){
    var ev = document.createEvent("KeyboardEvent");
    ev.initKeyboardEvent(type, true, true, window, data.ctrlKey, data.altKey, data.shiftKey, data.metaKey, data.keyCode, data.charCode);
    element.dispatchEvent(ev);
};

PortiaPage.sendEvent.simple = function(element, data, type) {
    var ev = document.createEvent('Event');
    ev.initEvent(type, true, false);
    element.dispatchEvent(ev);
};

PortiaPage.sendEvent.focus = function(element, data, type) {
    if(type in element){
        element[type](); // This will trigger the event
    }
};

PortiaPage.sendEvent.scroll = function(element, data){
    // Scroll events in the body are dispatched on the documentElement, reverse this
    if(element === document.documentElement && element.scrollHeight === document.body.scrollHeight){
        element = document.body;
    }
    // This will trigger the scroll event
    element.scrollTop = data.scrollTop;
    element.scrollLeft = data.scrollLeft;
};

PortiaPage.sendEvent.unknown = function(element, data, type) {
    console.log('Unknown event category for event ' + type);
};

PortiaPage.sendEvent.mouse = function(element, data, type) {
    var clientRect = element.getBoundingClientRect();
    var clientX = data.targetX + clientRect.left;
    var clientY = data.targetY + clientRect.top;

    var ev = document.createEvent("MouseEvent");
    ev.initMouseEvent(type, true, true, window, data.detail || 0,
                      clientX, clientY, clientX, clientY,
                      data.ctrlKey, data.altKey, data.shiftKey, data.metaKey, data.button, null);
    element.dispatchEvent(ev);
};

PortiaPage.prototype.sendEvent = function(data) {
    var element = this.getByNodeId(data.target);
    if (!element) {
        throw new Error("Event target doesn't exist.");
    }
    Object.keys(data.propsBefore || {}).forEach(function(propName){
        element[propName] = data.propsBefore[propName];
    });

    PortiaPage.sendEvent[data.category].call(this, element, data, data.type);

    Object.keys(data.propsAfter || {}).forEach(function(propName){
        element[propName] = data.propsAfter[propName];
    });
};

PortiaPage.prototype.getByNodeId = function(nodeId){
    return this.mirrorClient.knownNodes.byId[nodeId];
};

PortiaPage.prototype.pyGetByNodeId = function(nodeId){
    // Workarround to return QWebElement in python
    var res = this.getByNodeId(nodeId);
    if(res) {
        __portiaApi.returnElement(res);
    }
};

var incrementDialogCounter = function(){
    if(++incrementDialogCounter.count > MAX_DIALOGS) {
        throw new Error('Not allowed');
    }
};
incrementDialogCounter.count = 0;

window.alert = function(){};

window.prompt = function(){
    incrementDialogCounter();
    return null; // dismiss the prompt (clicking cancel or closing the window)
};
window.confirm = function(){
    incrementDialogCounter();
    return true;
};

if(!('livePortiaPage' in window)){
    window.livePortiaPage = new PortiaPage();
}
})();
//# sourceMappingURL=combined.map
