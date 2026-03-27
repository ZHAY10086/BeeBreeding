/**
 * Main application for bee breeding tree visualization
 */
import { buildHierarchy } from "../data/beeProcessor.js";
import { loadBeeData } from "../data/dataLoader.js";
import { renderEdges } from "../visualization/edgeRenderer.js";
import { positionNodes } from "../visualization/layout.js";
import { renderNodes } from "../visualization/nodeRenderer.js";
import { config } from "./config.js";
import { I18n } from "./i18n/i18n.js";

export class BeeBreedingApp {
  constructor() {
    this.useColumnLayoutForLeaves = false;
    this.beeData = null;
    this.fullHierarchyData = null; // Store full unfiltered hierarchy
    this.hierarchyData = null;
    this.nodes = [];
    this.links = [];
    this.nodeMap = new Map();
    this.nodeColors = {};
    this.linksByTarget = null;
    this.svg = null;
    this.g = null;
    this.link = null;
    this.node = null;
    this.zoom = null;
    this.isFilteredView = false;
    this.originalPositions = new Map();
    this.currentSelectedNode = null;
    // Will be populated from HTML checkboxes on initialization
    this.selectedMods = new Set();
    this.isModFiltered = false;
    // Search state
    this.isSearching = false;
    // Internationalization
    this.i18n = new I18n();
  }

  async initialize() {
    console.log("Initializing BeeBreedingApp...");

    try {
      // Load saved language
      this.i18n.loadSavedLanguage();
      
      // Read checkbox states FIRST, before building hierarchy
      this.readCheckboxStates();

      // Load and process data
      this.beeData = await loadBeeData();
      console.log("Loaded bee data:", Object.keys(this.beeData).length, "bees");

      // Build full hierarchy and store it
      this.fullHierarchyData = buildHierarchy(this.beeData, this.i18n);

      // Filter data based on checkbox states
      let filteredBeeData = this.getFilteredBeeData();

      // Build hierarchy with filtered data
      this.hierarchyData = buildHierarchy(filteredBeeData, this.i18n);
      this.nodes = this.hierarchyData.nodes;
      this.links = this.hierarchyData.links;
      this.nodeMap = this.hierarchyData.nodeMap;

      console.log(
        "Built hierarchy with",
        this.nodes.length,
        "nodes and",
        this.links.length,
        "links"
      );

      // Debug: Check if we have any nodes/links
      if (this.nodes.length === 0) {
        console.warn("WARNING: No nodes found in hierarchy!");
      }
      if (this.links.length === 0) {
        console.warn("WARNING: No links found in hierarchy!");
      }

      // Calculate node widths BEFORE positioning
      this.nodes.forEach((node) => {
        const text = node.name || node.id;
        node.width = Math.max(100, text.toUpperCase().length * 9 + 30);
      });

      // Position nodes (now with widths set)
      positionNodes(
        this.nodes,
        this.useColumnLayoutForLeaves
          ? config.layoutModes.COLUMN
          : config.layoutModes.SPLIT
      );

      // Assign colors intelligently after positions are calculated
      this.nodeColors = this.assignNodeColors(this.nodes, this.nodeMap);

      // Set up SVG
      this.setupSVG();

      // Debug: Check if SVG was set up correctly
      if (!this.svg || !this.g) {
        console.error("ERROR: SVG setup failed - no svg or g element");
        return;
      }

      // Render visualization
      this.renderVisualization();

      // Debug: Check if rendering created any elements
      if (!this.node || !this.link) {
        console.error("ERROR: Rendering failed - no nodes or links created");
        return;
      }

      // Set up zoom
      this.setupZoom();

      // Set up controls
      this.setupControls();

      // Set up mod filters (reads initial state from checkboxes)
      this.setupModFilters();

      // Set up search
      this.setupSearch();

      // Set up resize handler
      this.setupResizeHandler();

      // Initial fit (show all bees)
      this.fitView();

      // Update UI elements with current language
      this.updateUIElements();

      console.log("Initialization complete");
    } catch (error) {
      console.error("Error during initialization:", error);
      throw error;
    }
  }

  setupSVG() {
    this.svg = d3
      .select("#tree-svg")
      .attr("width", "100%")
      .attr("height", "100vh");

    this.g = this.svg.append("g");
  }

  renderVisualization() {
    // Note: Node widths are already calculated in initialize() before positioning

    // Create linksByTarget map for border rendering
    this.linksByTarget = d3.group(this.links, (d) => d.target);

    // Determine current layout mode
    const layoutMode = this.useColumnLayoutForLeaves
      ? config.layoutModes.COLUMN
      : config.layoutModes.SPLIT;

    // Render edges (now nodes have their widths set)
    const edgeResult = renderEdges(
      this.g,
      this.links,
      this.nodes,
      this.nodeMap,
      this.nodeColors,
      layoutMode
    );
    this.link = edgeResult.link;

    // In COLUMN layout mode, hide edges to childless nodes (unless in filtered mode)
    if (layoutMode === config.layoutModes.COLUMN && !this.isFilteredView) {
      this.link.style("display", (d) => {
        const targetNode = this.nodeMap.get(d.target);
        return targetNode.children.length > 0 ? null : "none";
      });
    }

    // Render nodes
    const nodeResult = renderNodes(
      this.g,
      this.nodes,
      this.links,
      this.nodeMap,
      this.nodeColors
    );
    this.node = nodeResult.node;

    // Set up node click handlers
    this.setupNodeInteractions();
  }

  selectNode(node) {
    // Save the selected node
    this.currentSelectedNode = node;

    // Check if filter mode checkbox is checked
    const filterModeCheckbox = document.getElementById("filterModeToggle");
    const showAllNodes = filterModeCheckbox ? filterModeCheckbox.checked : true;

    if (showAllNodes) {
      // Default behavior: show all nodes, fade unrelated
      this.highlightConnections(node);
    } else {
      // Filtered view: show only related nodes with rearranged layout
      this.showFilteredView(node);
    }

    this.showInfo(node);
  }

  highlightMultipleNodes(nodes) {
    // Clear current selection
    this.currentSelectedNode = null;

    // Reset highlighting and fading
    this.node.classed("highlighted connected faded", false);
    this.link.classed("highlighted faded", false);

    // Remove any existing outer selection borders
    this.node.selectAll(".outer-selection-border").remove();

    // Reset ALL node borders to their default colors
    this.resetNodeBorders();

    // Collect all IDs to highlight
    const highlightIds = new Set(nodes.map((n) => n.id));

    // Highlight all matching nodes
    this.node
      .filter((d) => highlightIds.has(d.id))
      .classed("highlighted", true);

    // Fade out non-highlighted nodes
    this.node.filter((d) => !highlightIds.has(d.id)).classed("faded", true);

    // Fade all links to emphasize the highlighted nodes
    this.link.classed("faded", true);

    // Hide info panel since no single node is selected
    document.getElementById("infoPanel").style.display = "none";
  }

  setupNodeInteractions() {
    this.node.on("click", (event, d) => {
      event.stopPropagation();
      this.selectNode(d);
    });

    // Clear selection on background click
    this.svg.on("click", () => this.resetHighlight());
  }

  assignNodeColors(nodes, nodeMap) {
    const nodeColors = {};
    const conflicts = new Map();

    // Initialize conflict sets
    nodes.forEach((node) => {
      conflicts.set(node.id, new Set());
    });

    // Add STRICT parent-child conflicts - nodes MUST differ from parents and children
    nodes.forEach((node) => {
      node.parents.forEach((parentId) => {
        if (conflicts.has(parentId)) {
          conflicts.get(node.id).add(parentId);
          conflicts.get(parentId).add(node.id);
        }
      });
      node.children.forEach((childId) => {
        if (conflicts.has(childId)) {
          conflicts.get(node.id).add(childId);
          conflicts.get(childId).add(node.id);
        }
      });

      // STRICT: Add conflicts between parents of the same node
      // This ensures parents ALWAYS have different colors from each other
      if (node.parents.length > 1) {
        for (let i = 0; i < node.parents.length; i++) {
          for (let j = i + 1; j < node.parents.length; j++) {
            const parent1 = node.parents[i];
            const parent2 = node.parents[j];
            if (conflicts.has(parent1) && conflicts.has(parent2)) {
              conflicts.get(parent1).add(parent2);
              conflicts.get(parent2).add(parent1);
            }
          }
        }
      }
    });

    // Add spatial proximity conflicts for better visual separation
    const proximityThreshold = 100;
    nodes.forEach((nodeA) => {
      nodes.forEach((nodeB) => {
        if (nodeA.id !== nodeB.id) {
          const distance = Math.sqrt(
            Math.pow(nodeA.x - nodeB.x, 2) + Math.pow(nodeA.y - nodeB.y, 2)
          );
          if (distance < proximityThreshold) {
            conflicts.get(nodeA.id).add(nodeB.id);
            conflicts.get(nodeB.id).add(nodeA.id);
          }
        }
      });
    });

    // Sort nodes by generation first (CRITICAL: color parents before children),
    // then by number of conflicts for tie-breaking
    const sortedNodes = nodes.slice().sort((a, b) => {
      if (a.generation !== b.generation) {
        return a.generation - b.generation; // Lower generation first
      }
      return conflicts.get(b.id).size - conflicts.get(a.id).size;
    });

    // Assign colors with GUARANTEED parent-child and parent-parent differentiation
    sortedNodes.forEach((node, nodeIndex) => {
      const strictForbiddenColors = new Set(); // Colors we MUST NOT use (parents)
      const preferredAvoidColors = new Set(); // Colors we prefer to avoid (spatial conflicts)

      // STRICT: Collect colors from direct parents (MUST differ from these)
      node.parents.forEach((parentId) => {
        if (nodeColors[parentId] !== undefined) {
          strictForbiddenColors.add(nodeColors[parentId]);
        }
      });

      // Collect colors from direct children (MUST differ from these)
      node.children.forEach((childId) => {
        if (nodeColors[childId] !== undefined) {
          strictForbiddenColors.add(nodeColors[childId]);
        }
      });

      // STRICT: Collect colors from co-parents (siblings sharing children)
      // If this node is a parent, ensure it differs from other parents of the same children
      node.children.forEach((childId) => {
        const childNode = nodeMap.get(childId);
        if (childNode) {
          childNode.parents.forEach((coParentId) => {
            if (
              coParentId !== node.id &&
              nodeColors[coParentId] !== undefined
            ) {
              strictForbiddenColors.add(nodeColors[coParentId]);
            }
          });
        }
      });

      // Collect colors from other spatial conflicts (prefer to avoid, but not strict)
      conflicts.get(node.id).forEach((conflictId) => {
        if (nodeColors[conflictId] !== undefined) {
          const color = nodeColors[conflictId];
          if (!strictForbiddenColors.has(color)) {
            preferredAvoidColors.add(color);
          }
        }
      });

      // Create a preferred color based on generation and position for diversity
      const preferredColor =
        (node.generation * 3 + Math.abs(node.y) / 50) %
        config.availableColors.length;

      // Try preferred color first if it's not strictly forbidden
      if (!strictForbiddenColors.has(Math.floor(preferredColor))) {
        nodeColors[node.id] = Math.floor(preferredColor);
      } else {
        // Find first available color that's not strictly forbidden
        // Prefer colors that aren't in preferredAvoidColors either
        let colorIndex = -1;

        // First pass: try to find a color that avoids both strict and preferred conflicts
        for (let i = 0; i < config.availableColors.length; i++) {
          const testIndex = (nodeIndex * 7 + i) % config.availableColors.length;
          if (
            !strictForbiddenColors.has(testIndex) &&
            !preferredAvoidColors.has(testIndex)
          ) {
            colorIndex = testIndex;
            break;
          }
        }

        // Second pass: if no "perfect" color found, just avoid strict conflicts
        if (colorIndex === -1) {
          for (let i = 0; i < config.availableColors.length; i++) {
            if (!strictForbiddenColors.has(i)) {
              colorIndex = i;
              break;
            }
          }
        }

        // ABSOLUTE GUARANTEE: This should never happen with 15 colors, but if it does,
        // use a deterministic hash and then force it to differ from parents
        if (colorIndex === -1) {
          colorIndex =
            Math.abs(
              node.id.split("").reduce((a, b) => {
                a = (a << 5) - a + b.charCodeAt(0);
                return a & a;
              }, 0)
            ) % config.availableColors.length;

          // Force differentiation from parents
          let safetyAttempts = 0;
          while (
            strictForbiddenColors.has(colorIndex) &&
            safetyAttempts < config.availableColors.length
          ) {
            colorIndex = (colorIndex + 1) % config.availableColors.length;
            safetyAttempts++;
          }
        }

        nodeColors[node.id] = colorIndex;
      }
    });

    return nodeColors;
  }

  getAllAncestors(nodeId, visited = new Set()) {
    if (visited.has(nodeId)) return new Set();
    visited.add(nodeId);

    const ancestors = new Set();
    const node = this.nodeMap.get(nodeId);
    if (node && node.parents) {
      node.parents.forEach((parentId) => {
        ancestors.add(parentId);
        const parentAncestors = this.getAllAncestors(
          parentId,
          new Set(visited)
        );
        parentAncestors.forEach((ancestor) => ancestors.add(ancestor));
      });
    }
    return ancestors;
  }

  getAllDescendants(nodeId, visited = new Set()) {
    if (visited.has(nodeId)) return new Set();
    visited.add(nodeId);

    const descendants = new Set();
    const node = this.nodeMap.get(nodeId);
    if (node && node.children) {
      node.children.forEach((childId) => {
        descendants.add(childId);
        const childDescendants = this.getAllDescendants(
          childId,
          new Set(visited)
        );
        childDescendants.forEach((descendant) => descendants.add(descendant));
      });
    }
    return descendants;
  }

  getModFromId(nodeId) {
    // Extract mod name from ID format "modname:beename"
    const parts = nodeId.split(":");
    if (parts.length > 1) {
      const modName = parts[0].toLowerCase();
      // Normalize "CareerBees" to "careerbees" for matching
      return modName.replace(/\s+/g, "");
    }
    return "unknown";
  }

  applyModFilter() {
    // Clear SVG content
    this.g.selectAll("*").remove();

    let filteredBeeData;

    if (this.selectedMods.size === 0) {
      // No mods selected - use all bees
      filteredBeeData = this.beeData;
      this.isModFiltered = false;
    } else {
      // Filter bee data to selected mods
      const allMods = [
        "forestry",
        "extrabees",
        "magicbees",
        "careerbees",
        "meatballcraft",
      ];
      const allSelected = allMods.every((mod) => this.selectedMods.has(mod));

      if (allSelected) {
        // All mods selected - use all bees
        filteredBeeData = this.beeData;
        this.isModFiltered = false;
      } else {
        // Filter to selected mods + their dependencies
        filteredBeeData = {};

        // First pass: collect all bees from selected mods
        const selectedBeeIds = new Set();
        Object.keys(this.beeData).forEach((beeId) => {
          const modName = this.getModFromId(beeId);
          if (this.selectedMods.has(modName)) {
            selectedBeeIds.add(beeId);
          }
        });

        // Second pass: recursively add all ancestors
        const beesWithAncestors = new Set(selectedBeeIds);
        const addAncestors = (beeId) => {
          const fullNode = this.fullHierarchyData.nodeMap.get(beeId);
          if (fullNode && fullNode.parents) {
            fullNode.parents.forEach((parentId) => {
              if (!beesWithAncestors.has(parentId)) {
                beesWithAncestors.add(parentId);
                addAncestors(parentId);
              }
            });
          }
        };

        selectedBeeIds.forEach((beeId) => addAncestors(beeId));

        // Build filtered bee data
        beesWithAncestors.forEach((beeId) => {
          filteredBeeData[beeId] = this.beeData[beeId];
        });

        this.isModFiltered = true;
      }
    }

    // Rebuild hierarchy with filtered data
    this.hierarchyData = buildHierarchy(filteredBeeData, this.i18n);
    this.nodes = this.hierarchyData.nodes;
    this.links = this.hierarchyData.links;
    this.nodeMap = this.hierarchyData.nodeMap;

    // Calculate node widths
    this.nodes.forEach((node) => {
      const text = node.name || node.id;
      node.width = Math.max(100, text.toUpperCase().length * 9 + 30);
    });

    // Position nodes
    positionNodes(
      this.nodes,
      this.useColumnLayoutForLeaves
        ? config.layoutModes.COLUMN
        : config.layoutModes.SPLIT
    );

    // Assign colors
    this.nodeColors = this.assignNodeColors(this.nodes, this.nodeMap);

    // Render visualization
    this.renderVisualization();

    // Update zoom constraints
    this.updateZoomConstraints(this.nodes);

    // Fit view
    this.fitView();
  }

  highlightConnections(selectedNode) {
    // Reset highlighting and fading
    this.node.classed("highlighted connected faded", false);
    this.link.classed("highlighted faded", false);

    // Remove any existing outer selection borders
    this.node.selectAll(".outer-selection-border").remove();

    // Reset ALL node borders to their default colors
    this.resetNodeBorders();

    // Highlight selected node
    this.node
      .filter((d) => d.id === selectedNode.id)
      .classed("highlighted", true);

    // Add red outline outside the existing colored borders
    this.addSelectionBorder(selectedNode);

    // Recursively collect ALL ancestors and descendants
    const allAncestors = this.getAllAncestors(selectedNode.id);
    const allDescendants = this.getAllDescendants(selectedNode.id);

    // Collect connected node IDs
    const connectedIds = new Set([selectedNode.id]);
    allAncestors.forEach((id) => connectedIds.add(id));
    allDescendants.forEach((id) => connectedIds.add(id));

    // Highlight connected nodes
    this.node
      .filter((d) => allAncestors.has(d.id) || allDescendants.has(d.id))
      .classed("connected", true);

    // Fade out unconnected nodes
    this.node.filter((d) => !connectedIds.has(d.id)).classed("faded", true);

    // Highlight relevant links
    const highlightedLinks = this.link.filter(
      (d) => connectedIds.has(d.source) && connectedIds.has(d.target)
    );

    highlightedLinks.classed("highlighted", true);

    // Fade non-highlighted links
    this.link
      .filter(
        (d) => !(connectedIds.has(d.source) && connectedIds.has(d.target))
      )
      .classed("faded", true);

    // Move highlighted links to end of link group
    const app = this;
    highlightedLinks.each(function () {
      app.g.node().appendChild(this);
    });

    // Ensure connected nodes stay in node group
    this.node
      .filter(
        (d) =>
          allAncestors.has(d.id) ||
          allDescendants.has(d.id) ||
          d.id === selectedNode.id
      )
      .each(function () {
        app.g.node().appendChild(this);
      });
  }

  resetNodeBorders() {
    const app = this;
    this.node.each(function (d) {
      const nodeElement = d3.select(this);
      const inputLinks = app.linksByTarget.get(d.id) || [];

      if (inputLinks.length === 0) {
        nodeElement.selectAll(".node-border").attr("stroke", "#000");
      } else if (inputLinks.length === 1) {
        const edgeColor =
          config.availableColors[app.nodeColors[inputLinks[0].source] || 0];
        nodeElement
          .selectAll(".node-border, .node-border-segment")
          .attr("stroke", edgeColor);
      } else {
        // Multiple inputs - restore segment colors
        const sortedLinks = inputLinks
          .map((link) => {
            return {
              link,
              sourceY: app.nodeMap.get(link.source).y,
            };
          })
          .sort((a, b) => a.sourceY - b.sourceY)
          .map((item, index) => {
            let targetYOffset = 0;
            if (inputLinks.length > 1) {
              const spacing = config.spacing;
              const totalHeight = (inputLinks.length - 1) * spacing;
              targetYOffset = index * spacing - totalHeight / 2;
            }
            return {
              link: item.link,
              offset: targetYOffset,
              index,
            };
          });

        // Find the colors based on actual spatial position
        const topLinks = sortedLinks.filter((item) => item.offset < 0);
        const bottomLinks = sortedLinks.filter((item) => item.offset >= 0);

        const topColor =
          topLinks.length > 0
            ? config.availableColors[
                app.nodeColors[topLinks[topLinks.length - 1].link.source] || 0
              ]
            : config.availableColors[
                app.nodeColors[sortedLinks[0].link.source] || 0
              ];
        const bottomColor =
          bottomLinks.length > 0
            ? config.availableColors[
                app.nodeColors[bottomLinks[0].link.source] || 0
              ]
            : config.availableColors[
                app.nodeColors[
                  sortedLinks[sortedLinks.length - 1].link.source
                ] || 0
              ];

        const segments = nodeElement.selectAll(".node-border-segment").nodes();
        if (segments.length >= 4) {
          d3.select(segments[0]).attr("stroke", topColor);
          d3.select(segments[1]).attr("stroke", bottomColor);
          d3.select(segments[2]).attr("stroke", "#ddd");
          d3.select(segments[3]).attr("stroke", "#ddd");
        }
      }
    });
  }

  addSelectionBorder(selectedNode) {
    this.node
      .filter((d) => d.id === selectedNode.id)
      .each(function (d) {
        const nodeElement = d3.select(this);
        const halfWidth = d.width / 2;
        const borderOffset = 4.5;
        const outerHalfWidth = halfWidth + borderOffset;
        const outerHeight = 15 + borderOffset;
        const outerRx =
          config.borderRadiusX +
          (borderOffset * config.borderRadiusX) / halfWidth;
        const outerRy =
          config.borderRadiusY + (borderOffset * config.borderRadiusY) / 15;

        const outerBorderPath = `M${-outerHalfWidth + outerRx},-${outerHeight}
                                   L${outerHalfWidth - outerRx},-${outerHeight}
                                   Q${outerHalfWidth},-${outerHeight} ${outerHalfWidth},${
          -outerHeight + outerRy
        }
                                   L${outerHalfWidth},${outerHeight - outerRy}
                                   Q${outerHalfWidth},${outerHeight} ${
          outerHalfWidth - outerRx
        },${outerHeight}
                                   L${-outerHalfWidth + outerRx},${outerHeight}
                                   Q${-outerHalfWidth},${outerHeight} ${-outerHalfWidth},${
          outerHeight - outerRy
        }
                                   L${-outerHalfWidth},${-outerHeight + outerRy}
                                   Q${-outerHalfWidth},-${outerHeight} ${
          -outerHalfWidth + outerRx
        },-${outerHeight} Z`;

        nodeElement
          .append("path")
          .attr("d", outerBorderPath)
          .attr("stroke", "#ff4444")
          .attr("stroke-width", 6)
          .attr("fill", "none")
          .attr("class", "outer-selection-border");
      });
  }

  showInfo(selectedNode) {
    // Update the bee name
    document.getElementById("selectedBeeName").textContent =
      selectedNode.name || selectedNode.id;
    document.getElementById("generation").textContent = selectedNode.generation;

    // Update info panel labels by updating the specific strong elements
    const strongElements = document.querySelectorAll("#infoPanel strong");
    if (strongElements.length >= 3) {
      strongElements[0].textContent = this.i18n.t('infoPanel.generation');
      strongElements[1].textContent = this.i18n.t('infoPanel.parents');
      strongElements[2].textContent = this.i18n.t('infoPanel.children');
    }

    // Update the h4 title
    const infoPanelH4 = document.querySelector("#infoPanel h4");
    if (infoPanelH4) {
      infoPanelH4.textContent = this.i18n.t('infoPanel.selectedBee');
    }

    // Display parent combinations
    const parentsDiv = document.getElementById("parents");
    if (
      selectedNode.parentCombinations &&
      selectedNode.parentCombinations.length > 0
    ) {
      const parentText = selectedNode.parentCombinations
        .map((combo) =>
          combo
            .map((parentId) => {
              // Get translated name from i18n
              const translatedName = this.i18n.getBeeName(parentId);
              const parentNode = this.nodeMap.get(parentId);
              return translatedName || (parentNode
                ? parentNode.name || parentId.split(":")[1] || parentId
                : parentId);
            })
            .join(" + ")
        )
        .join(" OR ");
      parentsDiv.textContent = parentText;
    } else {
      parentsDiv.textContent = this.i18n.t('infoPanel.baseSpecies');
    }

    // Display children with their display names
    const childrenText = selectedNode.children
      .map((childId) => {
        // Get translated name from i18n
        const translatedName = this.i18n.getBeeName(childId);
        const childNode = this.nodeMap.get(childId);
        return translatedName || (childNode
          ? childNode.name || childId.split(":")[1] || childId
          : childId);
      })
      .join(", ");

    document.getElementById("children").textContent =
      childrenText || this.i18n.t('infoPanel.finalEvolution');
    document.getElementById("infoPanel").style.display = "block";
  }

  resetHighlight() {
    // Don't reset if we're in search mode
    if (this.isSearching) {
      return;
    }
    
    // Clear current selection
    this.currentSelectedNode = null;

    // If we're in filtered view, restore original layout
    if (this.isFilteredView) {
      this.restoreOriginalView();
      return;
    }

    this.node.classed("highlighted connected faded", false);
    this.link.classed("highlighted faded", false);

    // Remove outer selection borders
    this.node.selectAll(".outer-selection-border").remove();

    // Reset all node borders to their default colors
    this.resetNodeBorders();

    // Restore proper stacking order: ensure link group is below node group
    const linkGroup = this.g.select(".links");
    const nodeGroup = this.g.select(".nodes");

    if (linkGroup.node() && nodeGroup.node()) {
      // Move link group to be first child (bottom of stack)
      this.g.node().insertBefore(linkGroup.node(), this.g.node().firstChild);
      // Node group should already be on top, but ensure it
      this.g.node().appendChild(nodeGroup.node());
    }

    document.getElementById("infoPanel").style.display = "none";
  }

  showFilteredView(selectedNode) {
    this.isFilteredView = true;

    // Disable layout toggle button
    const layoutButton = document.getElementById("layoutToggle");
    if (layoutButton) {
      layoutButton.disabled = true;
      layoutButton.style.opacity = "0.5";
      layoutButton.style.cursor = "not-allowed";
    }

    // Clear any previous highlights/classes
    this.node.classed("highlighted connected faded", false);
    this.link.classed("highlighted faded", false);
    this.node.selectAll(".outer-selection-border").remove();

    // Save original positions only if not already saved
    if (this.originalPositions.size === 0) {
      this.nodes.forEach((node) => {
        this.originalPositions.set(node.id, { x: node.x, y: node.y });
      });
    }

    // Collect related nodes
    const allAncestors = this.getAllAncestors(selectedNode.id);
    const allDescendants = this.getAllDescendants(selectedNode.id);
    const connectedIds = new Set([selectedNode.id]);
    allAncestors.forEach((id) => connectedIds.add(id));
    allDescendants.forEach((id) => connectedIds.add(id));

    // Filter nodes and links
    const filteredNodes = this.nodes.filter((n) => connectedIds.has(n.id));
    const filteredLinks = this.links.filter(
      (l) => connectedIds.has(l.source) && connectedIds.has(l.target)
    );

    // Rearrange filtered nodes for better readability
    this.arrangeFilteredNodes(filteredNodes, selectedNode);

    // Hide unrelated nodes and links
    this.node.style("display", (d) => (connectedIds.has(d.id) ? null : "none"));

    this.link.style("display", (d) =>
      connectedIds.has(d.source) && connectedIds.has(d.target) ? null : "none"
    );

    // Highlight the selected node
    this.node
      .filter((d) => d.id === selectedNode.id)
      .classed("highlighted", true);

    this.addSelectionBorder(selectedNode);

    // Highlight connected nodes
    this.node
      .filter((d) => allAncestors.has(d.id) || allDescendants.has(d.id))
      .classed("connected", true);

    // Update to new positions immediately
    this.node
      .filter((d) => connectedIds.has(d.id))
      .attr("transform", (d) => `translate(${d.x},${d.y})`);

    // Recalculate edge Y offsets for filtered nodes
    const filteredLinksByTarget = d3.group(filteredLinks, (l) => l.target);

    filteredLinksByTarget.forEach((targetLinks, targetId) => {
      if (targetLinks.length > 1) {
        // Sort by NEW filtered source Y position (node that's higher up connects to top)
        // Create a map of filtered node positions for quick lookup
        const filteredNodePositions = new Map(
          filteredNodes.map((n) => [n.id, { x: n.x, y: n.y }])
        );

        const sortedLinks = targetLinks
          .map((link) => {
            // Use filtered node positions which have been updated by arrangeFilteredNodes
            const sourcePos = filteredNodePositions.get(link.source);
            return {
              link,
              sourceY: sourcePos
                ? sourcePos.y
                : this.nodeMap.get(link.source).y,
            };
          })
          .sort((a, b) => a.sourceY - b.sourceY);

        // Assign vertical offsets - lower index (higher up source) gets negative offset (top)
        const spacing = config.spacing;
        const totalHeight = (sortedLinks.length - 1) * spacing;

        sortedLinks.forEach((item, index) => {
          // Node at index 0 (highest source Y = smallest Y value) gets most negative offset (top)
          const targetYOffset = index * spacing - totalHeight / 2;
          item.link.targetYOffset = targetYOffset;
        });
      } else if (targetLinks.length === 1) {
        targetLinks[0].targetYOffset = 0;
      }
    });

    // Update the data on the D3 selection with new offsets
    this.link.each(function (d) {
      // Find the matching link in filteredLinks to get updated targetYOffset
      const matchingLink = filteredLinks.find(
        (l) => l.source === d.source && l.target === d.target
      );
      if (matchingLink && matchingLink.targetYOffset !== undefined) {
        d.targetYOffset = matchingLink.targetYOffset;
      }
    });

    // Update link positions immediately with recalculated offsets
    this.link
      .filter((d) => connectedIds.has(d.source) && connectedIds.has(d.target))
      .attr("d", (d) => {
        const source = this.nodeMap.get(d.source);
        const target = this.nodeMap.get(d.target);
        const sourceWidth = source.width || 120;
        const targetWidth = target.width || 120;
        const targetY = target.y + (d.targetYOffset || 0);

        const sourceX = source.x + sourceWidth / 2;
        const targetX = target.x - targetWidth / 2 + 3;
        const sourceXStraight = sourceX + config.straightLength;
        const targetXStraight = targetX - config.straightLength;

        return `M${sourceX},${source.y} L${sourceXStraight},${source.y} L${targetXStraight},${targetY} L${targetX},${targetY}`;
      });

    // Update node borders to match the recalculated edge positions
    this.updateFilteredNodeBorders(filteredNodes, filteredLinks);

    // Recalculate zoom constraints for filtered nodes
    this.updateZoomConstraints(filteredNodes);

    // Fit view to filtered nodes immediately
    this.fitViewToNodes(filteredNodes);
  }

  arrangeFilteredNodes(filteredNodes, selectedNode) {
    // Create a set of filtered node IDs for quick lookup
    const filteredIds = new Set(filteredNodes.map((n) => n.id));

    // Recalculate generations for filtered nodes
    // Base nodes = nodes whose parents aren't in the filtered set
    const filteredGenerations = new Map();
    const visited = new Set();

    // Find base nodes in the filtered set
    const baseBees = filteredNodes.filter((node) => {
      // A node is a base node if it has no parents OR all its parents are outside the filtered set
      if (!node.parents || node.parents.length === 0) return true;
      return !node.parents.some((parentId) => filteredIds.has(parentId));
    });

    // Set generation 0 for base nodes
    baseBees.forEach((bee) => {
      filteredGenerations.set(bee.id, 0);
      visited.add(bee.id);
    });

    // Iteratively assign generations based on parent relationships within filtered set
    let changed = true;
    let iterations = 0;
    while (changed && iterations < 20) {
      iterations++;
      changed = false;

      filteredNodes.forEach((node) => {
        if (!visited.has(node.id) && node.parents && node.parents.length > 0) {
          // Find max generation among parents that are in the filtered set
          let maxParentGen = -1;
          let allFilteredParentsHaveGen = true;

          const filteredParents = node.parents.filter((p) =>
            filteredIds.has(p)
          );

          if (filteredParents.length === 0) {
            // No parents in filtered set, treat as base node
            filteredGenerations.set(node.id, 0);
            visited.add(node.id);
            changed = true;
          } else {
            for (const parentId of filteredParents) {
              if (!filteredGenerations.has(parentId)) {
                allFilteredParentsHaveGen = false;
                break;
              }
              maxParentGen = Math.max(
                maxParentGen,
                filteredGenerations.get(parentId)
              );
            }

            if (maxParentGen >= 0 && allFilteredParentsHaveGen) {
              filteredGenerations.set(node.id, maxParentGen + 1);
              visited.add(node.id);
              changed = true;
            }
          }
        }
      });
    }

    // Group nodes by their NEW filtered generations
    const generations = d3.group(
      filteredNodes,
      (d) => filteredGenerations.get(d.id) || 0
    );
    const sortedGens = Array.from(generations.keys()).sort((a, b) => a - b);

    // Calculate cumulative X positions with dynamic spacing
    const generationXPositions = new Map();
    generationXPositions.set(0, 0);

    for (let gen = 0; gen < sortedGens.length - 1; gen++) {
      const currentX = generationXPositions.get(gen);

      const currentGenNodes = generations.get(sortedGens[gen]);
      const nextGenNodes = generations.get(sortedGens[gen + 1]);

      const maxCurrentWidth =
        currentGenNodes.length > 0
          ? Math.max(...currentGenNodes.map((n) => n.width || 100))
          : 100;
      const maxNextWidth =
        nextGenNodes && nextGenNodes.length > 0
          ? Math.max(...nextGenNodes.map((n) => n.width || 100))
          : 100;

      const straightSegments = config.straightLength * 2;
      const gap = config.gap;
      const spacing =
        maxCurrentWidth / 2 + straightSegments + gap + maxNextWidth / 2;

      generationXPositions.set(gen + 1, currentX + spacing);
    }

    // Position nodes generation by generation, sorted by number of children
    sortedGens.forEach((gen, genIndex) => {
      const genNodes = generations.get(gen);
      const xPos = generationXPositions.get(genIndex);

      // Sort by number of children (descending)
      const sortedByChildren = genNodes
        .slice()
        .sort((a, b) => b.children.length - a.children.length);

      // Reorder so the most children are in the middle (closest to center visually)
      const reordered = [];
      const isEven = sortedByChildren.length % 2 === 0;
      const mid = Math.floor(sortedByChildren.length / 2);

      for (let i = 0; i < sortedByChildren.length; i++) {
        let targetIndex;
        if (isEven) {
          // For even numbers: first at top-center (mid-1), second at bottom-center (mid)
          if (i === 0) {
            targetIndex = mid - 1;
          } else if (i === 1) {
            targetIndex = mid;
          } else if (i % 2 === 0) {
            // Even indices (2,4,6...) go above
            targetIndex = mid - 1 - i / 2;
          } else {
            // Odd indices (3,5,7...) go below
            // For i=3: (3-1)/2 = 1, so mid + 1
            // For i=5: (5-1)/2 = 2, so mid + 2
            targetIndex = mid + (i - 1) / 2;
          }
        } else {
          // For odd numbers: first at exact center
          if (i === 0) {
            targetIndex = mid;
          } else if (i % 2 === 1) {
            // Odd indices go above center
            targetIndex = mid - Math.ceil(i / 2);
          } else {
            // Even indices go below center
            targetIndex = mid + i / 2;
          }
        }
        reordered[targetIndex] = sortedByChildren[i];
      }

      // Clear genNodes and replace with reordered
      genNodes.length = 0;
      genNodes.push(...reordered);

      // Add alternating vertical stagger between generations for clarity
      // Odd indices go above (negative), even indices go below (positive)
      const staggerAmount = 30;
      const generationOffset =
        genIndex % 2 === 1
          ? -staggerAmount * Math.ceil(genIndex / 2)
          : staggerAmount * Math.floor(genIndex / 2);

      // Check if the selected node is in this generation
      const selectedNodeIndex = genNodes.findIndex(
        (n) => n.id === selectedNode.id
      );

      // Position nodes vertically, maintaining their relative order
      genNodes.forEach((node, i) => {
        node.x = xPos;

        if (node.id === selectedNode.id) {
          // Selected node is always centered at Y=400
          node.y = 400;
        } else {
          // Other nodes use normal spacing with stagger offset
          let baseY = 400 + generationOffset;

          // If selected node is in this generation, adjust positions around it
          if (selectedNodeIndex !== -1) {
            // Position relative to selected node
            const offsetFromSelected = i - selectedNodeIndex;
            node.y = 400 + offsetFromSelected * config.ySpacing;
          } else {
            // Normal positioning with stagger
            node.y = (i - (genNodes.length - 1) / 2) * config.ySpacing + baseY;
          }
        }
      });
    });
  }

  updateFilteredNodeBorders(filteredNodes, filteredLinks) {
    // Create a map of filtered node positions
    const filteredNodePositions = new Map(
      filteredNodes.map((n) => [n.id, { x: n.x, y: n.y }])
    );

    // Group links by target for border calculations
    const filteredLinksByTarget = d3.group(filteredLinks, (l) => l.target);

    const app = this;
    this.node
      .filter((d) => filteredNodePositions.has(d.id))
      .each(function (d) {
        const nodeElement = d3.select(this);
        const visibleInputLinks = filteredLinksByTarget.get(d.id) || [];

        if (visibleInputLinks.length === 0) {
          nodeElement.selectAll(".node-border").attr("stroke", "#000");
        } else if (visibleInputLinks.length === 1) {
          // Only 1 visible parent - use single color border
          const edgeColor =
            config.availableColors[
              app.nodeColors[visibleInputLinks[0].source] || 0
            ];
          nodeElement
            .selectAll(".node-border, .node-border-segment")
            .attr("stroke", edgeColor);
        } else {
          // Multiple visible parents - calculate segment colors using filtered positions
          const sortedLinks = visibleInputLinks
            .map((link) => {
              const sourcePos = filteredNodePositions.get(link.source);
              return {
                link,
                sourceY: sourcePos
                  ? sourcePos.y
                  : app.nodeMap.get(link.source).y,
              };
            })
            .sort((a, b) => a.sourceY - b.sourceY)
            .map((item, index) => {
              let targetYOffset = 0;
              if (visibleInputLinks.length > 1) {
                const spacing = config.spacing;
                const totalHeight = (visibleInputLinks.length - 1) * spacing;
                targetYOffset = index * spacing - totalHeight / 2;
              }
              return {
                link: item.link,
                offset: targetYOffset,
                index,
              };
            });

          // Find the colors based on actual spatial position
          // The first sorted link (smallest Y) gets most negative offset (top)
          // The last sorted link (largest Y) gets most positive offset (bottom)
          const topColor =
            config.availableColors[
              app.nodeColors[sortedLinks[0].link.source] || 0
            ];
          const bottomColor =
            config.availableColors[
              app.nodeColors[sortedLinks[sortedLinks.length - 1].link.source] ||
                0
            ];

          const segments = nodeElement
            .selectAll(".node-border-segment")
            .nodes();
          if (segments.length >= 4) {
            d3.select(segments[0]).attr("stroke", topColor);
            d3.select(segments[1]).attr("stroke", bottomColor);
            d3.select(segments[2]).attr("stroke", "#ddd");
            d3.select(segments[3]).attr("stroke", "#ddd");
          }
        }
      });
  }

  restoreOriginalView() {
    this.isFilteredView = false;

    // Re-enable layout toggle button
    const layoutButton = document.getElementById("layoutToggle");
    if (layoutButton) {
      layoutButton.disabled = false;
      layoutButton.style.opacity = "1";
      layoutButton.style.cursor = "pointer";
    }

    // Restore original positions
    this.nodes.forEach((node) => {
      const original = this.originalPositions.get(node.id);
      if (original) {
        node.x = original.x;
        node.y = original.y;
      }
    });

    // Clear saved positions so next filtered view saves fresh positions
    this.originalPositions.clear();

    // Recalculate edge Y offsets based on ORIGINAL positions
    const linksByTarget = d3.group(this.links, (l) => l.target);

    linksByTarget.forEach((targetLinks, targetId) => {
      if (targetLinks.length > 1) {
        // Sort by source Y position using RESTORED positions
        const sortedLinks = targetLinks
          .map((link) => {
            return {
              link,
              sourceY: this.nodeMap.get(link.source).y,
            };
          })
          .sort((a, b) => a.sourceY - b.sourceY);

        // Assign vertical offsets
        const spacing = config.spacing;
        const totalHeight = (sortedLinks.length - 1) * spacing;

        sortedLinks.forEach((item, index) => {
          const targetYOffset = index * spacing - totalHeight / 2;
          item.link.targetYOffset = targetYOffset;
        });
      } else if (targetLinks.length === 1) {
        targetLinks[0].targetYOffset = 0;
      }
    });

    // Update the data on the D3 selection with recalculated offsets
    this.link.each(function (d) {
      const matchingLink = Array.from(linksByTarget.values())
        .flat()
        .find((l) => l.source === d.source && l.target === d.target);
      if (matchingLink && matchingLink.targetYOffset !== undefined) {
        d.targetYOffset = matchingLink.targetYOffset;
      }
    });

    // Show all nodes and links
    this.node
      .style("display", null)
      .classed("highlighted connected faded", false);

    this.link.style("display", null).classed("highlighted faded", false);

    // In COLUMN layout mode, hide edges to childless nodes
    if (this.useColumnLayoutForLeaves) {
      this.link.style("display", (d) => {
        const targetNode = this.nodeMap.get(d.target);
        return targetNode.children.length > 0 ? null : "none";
      });
    }

    // Remove outer selection borders
    this.node.selectAll(".outer-selection-border").remove();

    // Update back to original positions immediately
    this.node.attr("transform", (d) => `translate(${d.x},${d.y})`);

    this.link.attr("d", (d) => {
      const source = this.nodeMap.get(d.source);
      const target = this.nodeMap.get(d.target);
      const sourceWidth = source.width || 120;
      const targetWidth = target.width || 120;
      const targetY = target.y + (d.targetYOffset || 0);

      const sourceX = source.x + sourceWidth / 2;
      const targetX = target.x - targetWidth / 2 + 3;
      const sourceXStraight = sourceX + config.straightLength;
      const targetXStraight = targetX - config.straightLength;

      return `M${sourceX},${source.y} L${sourceXStraight},${source.y} L${targetXStraight},${targetY} L${targetX},${targetY}`;
    });

    // Reset node borders AFTER positions and offsets are recalculated
    this.resetNodeBorders();

    // Restore proper stacking order: ensure link group is below node group
    const linkGroup = this.g.select(".links");
    const nodeGroup = this.g.select(".nodes");

    if (linkGroup.node() && nodeGroup.node()) {
      // Move link group to be first child (bottom of stack)
      this.g.node().insertBefore(linkGroup.node(), this.g.node().firstChild);
      // Node group should already be on top, but ensure it
      this.g.node().appendChild(nodeGroup.node());
    }

    document.getElementById("infoPanel").style.display = "none";

    // Recalculate zoom constraints for all nodes
    this.updateZoomConstraints(this.nodes);

    // Fit view immediately
    this.fitView();
  }

  fitViewToNodes(nodes) {
    // Calculate bounds for specific nodes
    const treeMinX = Math.min(...nodes.map((n) => n.x - (n.width || 100) / 2));
    const treeMaxX = Math.max(...nodes.map((n) => n.x + (n.width || 100) / 2));
    const treeMinY = Math.min(...nodes.map((n) => n.y));
    const treeMaxY = Math.max(...nodes.map((n) => n.y));

    const padding = 100;

    // Get actual SVG dimensions
    const svgNode = this.svg.node();
    const bounds = svgNode.getBoundingClientRect();
    const svgWidth = bounds.width;
    const svgHeight = bounds.height;

    // Calculate tree dimensions
    let treeWidth = treeMaxX - treeMinX;
    let treeHeight = treeMaxY - treeMinY;

    // If there are very few nodes (like a single node with no connections),
    // treat it as if there are at least N generations worth of space
    // This prevents a single node from filling the entire screen
    const minTreeWidth = config.xSpacing * (config.minZoomGenerations - 1); // N generation widths (N-1 spacing between them)
    const minTreeHeight = config.ySpacing * 4; // At least 5 node heights

    treeWidth = Math.max(treeWidth, minTreeWidth);
    treeHeight = Math.max(treeHeight, minTreeHeight);

    // Calculate scale to fit with padding
    const scale = 0.9 / Math.max(treeWidth / svgWidth, treeHeight / svgHeight);

    // Calculate center point
    const centerX = (treeMinX + treeMaxX) / 2;
    const centerY = (treeMinY + treeMaxY) / 2;

    // Use D3 zoom's scaleTo and translateTo for smooth animation
    this.svg
      .transition()
      .duration(750)
      .call(
        this.zoom.transform,
        d3.zoomIdentity
          .translate(svgWidth / 2, svgHeight / 2)
          .scale(scale)
          .translate(-centerX, -centerY)
      );
  }

  fitView() {
    // Fit to currently visible nodes only
    if (this.isFilteredView) {
      // In filtered view, fit to only the visible nodes
      const visibleNodes = this.nodes.filter((n) => {
        const nodeElement = this.node.filter((d) => d.id === n.id);
        return nodeElement.style("display") !== "none";
      });
      this.fitViewToNodes(visibleNodes);
    } else {
      // In normal view, fit to all nodes
      this.fitViewToNodes(this.nodes);
    }
  }

  toggleLeafLayout() {
    this.useColumnLayoutForLeaves = !this.useColumnLayoutForLeaves;

    // Update button text
    const button = document.getElementById("layoutToggle");

    // Update positions with transitions
    positionNodes(
      this.nodes,
      this.useColumnLayoutForLeaves
        ? config.layoutModes.COLUMN
        : config.layoutModes.SPLIT
    );

    // Re-render the entire visualization to update edge filtering
    // Clear and re-render
    this.g.selectAll("*").remove();
    this.renderVisualization();

    // Recalculate zoom constraints after layout change
    this.updateZoomConstraints(this.nodes);

    // Fit view after layout change
    this.fitView();
  }

  setupSearch() {
    let searchTimeout;
    const searchInput = document.getElementById("searchInput");

    searchInput.addEventListener("input", (e) => {
      // Clear previous timeout
      clearTimeout(searchTimeout);

      const searchTerm = e.target.value.toLowerCase();

      // Always debounce - wait for user to stop typing
      searchTimeout = setTimeout(() => {
        if (searchTerm.length === 0) {
          // Empty search - show full tree
          this.isSearching = false;
          if (this.isFilteredView) {
            this.restoreOriginalView();
          } else {
            this.resetHighlight();
          }
        } else {
          // Search for matching nodes with prioritization
          this.isSearching = true;
          // Only search by display name, extracting bee name from mod-prefixed IDs if needed
          const matches = this.nodes.filter((n) => {
            // Extract display name - if no explicit name, extract from ID (e.g., "forestry:commonBee" -> "commonBee")
            const displayName = n.name || n.id.split(":")[1] || n.id;
            return displayName.toLowerCase().includes(searchTerm);
          });

          // Separate exact matches from partial matches
          const exactMatches = matches.filter((n) => {
            const displayName = n.name || n.id.split(":")[1] || n.id;
            return displayName.toLowerCase() === searchTerm;
          });
          const partialMatches = matches.filter((n) => {
            const displayName = n.name || n.id.split(":")[1] || n.id;
            return displayName.toLowerCase() !== searchTerm;
          });

          // Sort partial matches by priority:
          // 1. Starts with search term
          // 2. Contains search term (shorter first)
          partialMatches.sort((a, b) => {
            const aName = (a.name || a.id.split(":")[1] || a.id).toLowerCase();
            const bName = (b.name || b.id.split(":")[1] || b.id).toLowerCase();

            // Check for starts with
            const aStarts = aName.startsWith(searchTerm);
            const bStarts = bName.startsWith(searchTerm);
            if (aStarts && !bStarts) return -1;
            if (!aStarts && bStarts) return 1;

            // Both contain search term, sort by length (shorter first)
            return aName.length - bName.length;
          });

          if (exactMatches.length > 0) {
            // Always select first exact match
            this.selectNode(exactMatches[0]);
          } else if (partialMatches.length === 1) {
            // Only one partial match - select it
            this.selectNode(partialMatches[0]);
          } else if (partialMatches.length > 1) {
            // Multiple partial matches - highlight all of them
            if (this.isFilteredView) {
              this.restoreOriginalView();
            }
            this.highlightMultipleNodes(partialMatches);
          } else {
            // No matches found - show full tree
            this.isSearching = false;
            if (this.isFilteredView) {
              this.restoreOriginalView();
            } else {
              this.resetHighlight();
            }
          }
        }
      }, config.searchDebounceDelay);
    });
  }

  setupControls() {
    console.log("Setting up controls...");

    // Bind global functions to app instance for HTML onclick handlers
    window.resetHighlight = () => this.resetHighlight();
    window.fitView = () => this.fitView();
    window.toggleLeafLayout = () => this.toggleLeafLayout();

    // Add checkbox change listener
    const filterModeCheckbox = document.getElementById("filterModeToggle");
    if (filterModeCheckbox) {
      filterModeCheckbox.addEventListener("change", () => {
        const showAllNodes = filterModeCheckbox.checked;
        console.log(
          "Filter mode checkbox changed. showAllNodes:",
          showAllNodes
        );

        // If checkbox is checked (showing all nodes), always fit to view
        if (showAllNodes) {
          // If a node is selected, switch visualization mode
          if (this.currentSelectedNode) {
            // Switch to fade mode
            if (this.isFilteredView) {
              console.log("Switching from filtered view to fade view");
              this.isFilteredView = false;

              // Restore original positions to node data
              this.nodes.forEach((node) => {
                const original = this.originalPositions.get(node.id);
                if (original) {
                  node.x = original.x;
                  node.y = original.y;
                }
              });

              // Clear saved positions
              this.originalPositions.clear();

              // Recalculate edge Y offsets based on RESTORED positions
              const linksByTarget = d3.group(this.links, (l) => l.target);

              linksByTarget.forEach((targetLinks, targetId) => {
                if (targetLinks.length > 1) {
                  // Sort by source Y position using RESTORED positions
                  const sortedLinks = targetLinks
                    .map((link) => {
                      return {
                        link,
                        sourceY: this.nodeMap.get(link.source).y,
                      };
                    })
                    .sort((a, b) => a.sourceY - b.sourceY);

                  // Assign vertical offsets
                  const spacing = config.spacing;
                  const totalHeight = (sortedLinks.length - 1) * spacing;

                  sortedLinks.forEach((item, index) => {
                    const targetYOffset = index * spacing - totalHeight / 2;
                    item.link.targetYOffset = targetYOffset;
                  });
                } else if (targetLinks.length === 1) {
                  targetLinks[0].targetYOffset = 0;
                }
              });

              // Update the data on the D3 selection with recalculated offsets
              this.link.each(function (d) {
                const matchingLink = Array.from(linksByTarget.values())
                  .flat()
                  .find((l) => l.source === d.source && l.target === d.target);
                if (matchingLink && matchingLink.targetYOffset !== undefined) {
                  d.targetYOffset = matchingLink.targetYOffset;
                }
              });

              // Show all nodes and links
              this.node
                .style("display", null)
                .classed("highlighted connected faded", false);

              this.link
                .style("display", null)
                .classed("highlighted faded", false);

              // In COLUMN layout mode, hide edges to childless nodes
              if (this.useColumnLayoutForLeaves) {
                this.link.style("display", (d) => {
                  const targetNode = this.nodeMap.get(d.target);
                  return targetNode.children.length > 0 ? null : "none";
                });
              }

              // Update positions immediately without animation
              this.node.attr("transform", (d) => `translate(${d.x},${d.y})`);

              this.link.attr("d", (d) => {
                const source = this.nodeMap.get(d.source);
                const target = this.nodeMap.get(d.target);
                const sourceWidth = source.width || 120;
                const targetWidth = target.width || 120;
                const targetY = target.y + (d.targetYOffset || 0);

                const sourceX = source.x + sourceWidth / 2;
                const targetX = target.x - targetWidth / 2 + 3;
                const sourceXStraight = sourceX + config.straightLength;
                const targetXStraight = targetX - config.straightLength;

                return `M${sourceX},${source.y} L${sourceXStraight},${source.y} L${targetXStraight},${targetY} L${targetX},${targetY}`;
              });

              // Reset node borders AFTER offsets are recalculated
              this.resetNodeBorders();
              
              // Restore proper stacking order: ensure link group is below node group
              const linkGroup = this.g.select(".links");
              const nodeGroup = this.g.select(".nodes");

              if (linkGroup.node() && nodeGroup.node()) {
                // Move link group to be first child (bottom of stack)
                this.g.node().insertBefore(linkGroup.node(), this.g.node().firstChild);
                // Node group should already be on top, but ensure it
                this.g.node().appendChild(nodeGroup.node());
              }

              // Re-enable layout toggle button
              const layoutButton = document.getElementById("layoutToggle");
              if (layoutButton) {
                layoutButton.disabled = false;
                layoutButton.style.opacity = "1";
                layoutButton.style.cursor = "pointer";
              }

              // Apply fade highlighting
              this.highlightConnections(this.currentSelectedNode);
              this.showInfo(this.currentSelectedNode);
            } else {
              console.log("Already in normal view, just applying fade");
              // Already in normal view, just apply fade
              this.highlightConnections(this.currentSelectedNode);
            }
          }

          // ALWAYS fit to view when showing all nodes, regardless of selected node state
          // Recalculate zoom constraints BEFORE fitting to ensure proper bounds
          console.log(
            "Updating zoom constraints and fitting to view for all nodes"
          );
          console.log("Number of nodes:", this.nodes.length);
          console.log("isFilteredView:", this.isFilteredView);

          // Update zoom constraints for all nodes
          this.updateZoomConstraints(this.nodes);

          // Use setTimeout to ensure zoom constraints are applied before fitting
          setTimeout(() => {
            console.log(
              "Fitting view to all nodes after zoom constraint update"
            );
            this.fitViewToNodes(this.nodes);
          }, 0);
        } else {
          // Checkbox unchecked - switch to filtered mode (only if node is selected)
          if (this.currentSelectedNode) {
            this.showFilteredView(this.currentSelectedNode);
            this.showInfo(this.currentSelectedNode);
          }
        }
      });
    }

    console.log("Controls bound to window object");

    // Set up language selector
    const languageSelect = document.getElementById('languageSelect');
    if (languageSelect) {
      // Set initial value
      languageSelect.value = this.i18n.getLanguage();
      
      // Add change event listener
      languageSelect.addEventListener('change', (event) => {
        this.changeLanguage(event.target.value);
      });
    }

    // Set up mod filter checkboxes
    this.setupModFilterListeners();
  }
  
  setupModFilterListeners() {
    // Add event listeners to mod filter checkboxes
    const checkboxes = document.querySelectorAll(".mod-filter-checkbox");
    checkboxes.forEach((checkbox) => {
      // Create a bound version of the handler
      const handler = this.handleModFilterChange.bind(this);
      // Store the handler reference on the checkbox for later removal
      checkbox._modFilterHandler = handler;
      // Add event listener
      checkbox.addEventListener("change", handler);
    });
  }
  
  handleModFilterChange(event) {
    const checkbox = event.target;
    const modName = checkbox.value.toLowerCase();
    
    if (checkbox.checked) {
      this.selectedMods.add(modName);
    } else {
      this.selectedMods.delete(modName);
    }
    
    // Apply the filter
    this.applyModFilter();
  }
  
  changeLanguage(lang) {
    if (this.i18n.setLanguage(lang)) {
      // Rebuild hierarchy with new language
      this.fullHierarchyData = buildHierarchy(this.beeData, this.i18n);
      
      // Rebuild current hierarchy
      let filteredBeeData = this.getFilteredBeeData();
      this.hierarchyData = buildHierarchy(filteredBeeData, this.i18n);
      this.nodes = this.hierarchyData.nodes;
      this.links = this.hierarchyData.links;
      this.nodeMap = this.hierarchyData.nodeMap;

      // Recalculate node widths with new names
      this.nodes.forEach((node) => {
        const text = node.name || node.id;
        node.width = Math.max(100, text.toUpperCase().length * 9 + 30);
      });

      // Reposition nodes
      positionNodes(
        this.nodes,
        this.useColumnLayoutForLeaves
          ? config.layoutModes.COLUMN
          : config.layoutModes.SPLIT
      );

      // Reassign colors
      this.nodeColors = this.assignNodeColors(this.nodes, this.nodeMap);

      // Re-render visualization
      this.g.selectAll("*").remove();
      this.renderVisualization();

      // Update UI elements
      this.updateUIElements();
      
      // If there was a selected node, reselect it and show info panel
      if (this.currentSelectedNode) {
        const newNode = this.nodeMap.get(this.currentSelectedNode.id);
        if (newNode) {
          this.selectNode(newNode);
        }
      }
    }
  }
  
  updateUIElements() {
    // Update page title
    const pageTitle = document.getElementById('pageTitle');
    if (pageTitle) {
      pageTitle.textContent = this.i18n.t('app.title');
    }
    
    // Update search placeholder
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.placeholder = this.i18n.t('controls.searchPlaceholder');
    }
    
    // Update faded mode label
    const fadedModeLabel = document.querySelector('label[for="filterModeToggle"]');
    if (fadedModeLabel) {
      fadedModeLabel.textContent = this.i18n.t('controls.fadedMode');
    }
    
    // Update buttons
    const clearButton = document.querySelector('button[onclick="resetHighlight()"]');
    if (clearButton) {
      clearButton.textContent = this.i18n.t('controls.clear');
    }
    
    const fitButton = document.querySelector('button[onclick="fitView()"]');
    if (fitButton) {
      fitButton.textContent = this.i18n.t('controls.fit');
    }
    
    const layoutButton = document.getElementById('layoutToggle');
    if (layoutButton) {
      layoutButton.textContent = this.i18n.t('controls.layout');
    }
    
    // Update mod filters header
    const modFiltersHeader = document.querySelector('.mod-filters-header h4');
    if (modFiltersHeader) {
      modFiltersHeader.textContent = this.i18n.t('modFilters.header');
    }
    
    // Update mod filter labels
    const modFilterLabels = [
      { value: 'forestry', key: 'modFilters.forestry' },
      { value: 'gendustry', key: 'modFilters.gendustry' },
      { value: 'extrabees', key: 'modFilters.extrabees' },
      { value: 'magicbees', key: 'modFilters.magicbees' },
      { value: 'careerbees', key: 'modFilters.careerbees' },
      { value: 'meatballcraft', key: 'modFilters.meatballcraft' }
    ];
    
    modFilterLabels.forEach(({ value, key }) => {
      const input = document.querySelector(`input[value="${value}"]`);
      if (input && input.parentElement) {
        // Remove any existing event listener first
        if (input._modFilterHandler) {
          input.removeEventListener("change", input._modFilterHandler);
        }
        const labelText = this.i18n.t(key);
        input.parentElement.innerHTML = `<input type="checkbox" class="mod-filter-checkbox" value="${value}" ${input.checked ? 'checked' : ''}> ${labelText}`;
      }
    });
    
    // Re-add event listeners to mod filter checkboxes after updating labels
    this.setupModFilterListeners();
    
    // Update info panel if it's visible
    const infoPanel = document.getElementById('infoPanel');
    if (infoPanel && infoPanel.style.display === 'block' && this.currentSelectedNode) {
      this.showInfo(this.currentSelectedNode);
    }
  }

  readCheckboxStates() {
    // Read current checkbox states to populate selectedMods
    const checkboxes = document.querySelectorAll(".mod-filter-checkbox");
    checkboxes.forEach((checkbox) => {
      const modName = checkbox.value.toLowerCase();
      if (checkbox.checked) {
        this.selectedMods.add(modName);
      }
    });
  }

  getFilteredBeeData() {
    // Get filtered bee data based on selectedMods
    if (this.selectedMods.size === 0) {
      return this.beeData;
    }

    const allMods = [
      "forestry",
      "extrabees",
      "magicbees",
      "careerbees",
      "meatballcraft",
    ];
    const allSelected = allMods.every((mod) => this.selectedMods.has(mod));

    if (allSelected) {
      return this.beeData;
    }

    // Filter to selected mods + their dependencies
    const filteredBeeData = {};

    // First pass: collect all bees from selected mods
    const selectedBeeIds = new Set();
    Object.keys(this.beeData).forEach((beeId) => {
      const modName = this.getModFromId(beeId);
      if (this.selectedMods.has(modName)) {
        selectedBeeIds.add(beeId);
      }
    });

    // Second pass: recursively add all ancestors
    const beesWithAncestors = new Set(selectedBeeIds);
    const addAncestors = (beeId) => {
      const fullNode = this.fullHierarchyData.nodeMap.get(beeId);
      if (fullNode && fullNode.parents) {
        fullNode.parents.forEach((parentId) => {
          if (!beesWithAncestors.has(parentId)) {
            beesWithAncestors.add(parentId);
            addAncestors(parentId);
          }
        });
      }
    };

    selectedBeeIds.forEach((beeId) => addAncestors(beeId));

    // Build filtered bee data
    beesWithAncestors.forEach((beeId) => {
      filteredBeeData[beeId] = this.beeData[beeId];
    });

    this.isModFiltered = true;
    return filteredBeeData;
  }

  setupModFilters() {
    const checkboxes = document.querySelectorAll(".mod-filter-checkbox");

    // Set up change listeners
    checkboxes.forEach((checkbox) => {
      checkbox.addEventListener("change", (e) => {
        const modName = e.target.value.toLowerCase();

        if (e.target.checked) {
          this.selectedMods.add(modName);
        } else {
          this.selectedMods.delete(modName);
        }

        // Apply the filter
        this.applyModFilter();
      });
    });
  }

  setupResizeHandler() {
    // Add resize listener to re-fit view when window size changes
    let resizeTimeout;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        // Re-fit the view to current content
        this.fitView();
      }, 250); // Debounce for 250ms
    });
    console.log("Resize handler set up");
  }

  setupZoom() {
    console.log("Setting up zoom behavior...");

    // Calculate initial fit scale to use as baseline for zoom constraints
    this.calculateInitialScale();

    // Calculate max scale based on node size constraint
    // Limit so nodes don't exceed 400px width on screen
    const maxNodeScreenWidth = 400;
    const avgNodeWidth = 150; // approximate average node width
    const maxScale = maxNodeScreenWidth / avgNodeWidth;

    // Set up zoom with constrained scale and pan (but disable wheel zoom)
    this.zoom = d3
      .zoom()
      .scaleExtent([
        this.initialScale * 0.8, // Can zoom out to 80% of fit view
        Math.min(this.initialScale * 3, maxScale), // Limit by node screen size
      ])
      .extent(() => {
        const bounds = this.svg.node().getBoundingClientRect();
        return [
          [0, 0],
          [bounds.width, bounds.height],
        ];
      })
      .translateExtent(this.calculateTranslateExtent())
      .on("zoom", (event) => {
        this.g.attr("transform", event.transform);
      });

    this.svg.call(this.zoom);
    console.log("Zoom behavior initialized with scale extent:", [
      this.initialScale * 0.8,
      Math.min(this.initialScale * 3, maxScale),
    ]);
  }

  calculateInitialScale() {
    // Calculate the scale that would fit all nodes
    const treeMinX = Math.min(
      ...this.nodes.map((n) => n.x - (n.width || 100) / 2)
    );
    const treeMaxX = Math.max(
      ...this.nodes.map((n) => n.x + (n.width || 100) / 2)
    );
    const treeMinY = Math.min(...this.nodes.map((n) => n.y));
    const treeMaxY = Math.max(...this.nodes.map((n) => n.y));

    const svgNode = this.svg.node();
    const bounds = svgNode.getBoundingClientRect();
    const svgWidth = bounds.width;
    const svgHeight = bounds.height;

    const treeWidth = treeMaxX - treeMinX;
    const treeHeight = treeMaxY - treeMinY;

    // Calculate scale to fit with padding (90% to leave some margin)
    this.initialScale =
      0.9 / Math.max(treeWidth / svgWidth, treeHeight / svgHeight);

    // Store tree bounds for pan constraints
    this.treeBounds = { treeMinX, treeMaxX, treeMinY, treeMaxY };
  }

  calculateTranslateExtent() {
    if (!this.treeBounds)
      return [
        [-Infinity, -Infinity],
        [Infinity, Infinity],
      ];

    const { treeMinX, treeMaxX, treeMinY, treeMaxY } = this.treeBounds;
    const svgNode = this.svg.node();
    const bounds = svgNode.getBoundingClientRect();
    const svgWidth = bounds.width;
    const svgHeight = bounds.height;

    // Calculate margins - ensure at least one column/row stays on screen
    // We want to allow panning until the opposite edge comes into view
    const marginX = treeMaxX - treeMinX - config.xSpacing; // Keep at least one column visible
    const marginY = treeMaxY - treeMinY - config.ySpacing; // Keep at least one row visible

    // Translate extent defines how far the content can be panned
    // [top-left corner can go to, bottom-right corner can go to]
    return [
      [treeMinX - marginX, treeMinY - marginY], // Min translate (content's min x,y)
      [treeMaxX + marginX, treeMaxY + marginY], // Max translate (content's max x,y)
    ];
  }

  updateZoomConstraints(nodes) {
    // Recalculate bounds and scale for the given set of nodes
    const treeMinX = Math.min(...nodes.map((n) => n.x - (n.width || 100) / 2));
    const treeMaxX = Math.max(...nodes.map((n) => n.x + (n.width || 100) / 2));
    const treeMinY = Math.min(...nodes.map((n) => n.y));
    const treeMaxY = Math.max(...nodes.map((n) => n.y));

    const svgNode = this.svg.node();
    const bounds = svgNode.getBoundingClientRect();
    const svgWidth = bounds.width;
    const svgHeight = bounds.height;

    let treeWidth = treeMaxX - treeMinX;
    let treeHeight = treeMaxY - treeMinY;

    // Apply minimum tree dimensions to prevent over-zooming on small trees
    const minTreeWidth = config.xSpacing * (config.minZoomGenerations - 1);
    const minTreeHeight = config.ySpacing * 4;

    treeWidth = Math.max(treeWidth, minTreeWidth);
    treeHeight = Math.max(treeHeight, minTreeHeight);

    // Calculate new initial scale using the adjusted dimensions
    this.initialScale =
      0.9 / Math.max(treeWidth / svgWidth, treeHeight / svgHeight);

    // Store updated tree bounds (use original bounds, not inflated)
    this.treeBounds = { treeMinX, treeMaxX, treeMinY, treeMaxY };

    // Calculate max scale based on node size constraint
    const maxNodeScreenWidth = 400;
    const avgNodeWidth = 150;
    const maxScale = maxNodeScreenWidth / avgNodeWidth;

    // Update zoom constraints
    this.zoom
      .scaleExtent([
        this.initialScale * 0.8, // Can zoom out to 80% of fit view
        Math.min(this.initialScale * 3, maxScale), // Limit by node screen size
      ])
      .translateExtent(this.calculateTranslateExtent())
      .on("zoom", (event) => {
        this.g.attr("transform", event.transform);
      });

    // Re-apply the zoom behavior to the SVG
    this.svg.call(this.zoom);
  }
}
