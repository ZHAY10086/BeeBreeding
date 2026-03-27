/**
 * Bee data processor for building hierarchical relationships
 */
export function buildHierarchy(beeData, i18n = null) {
  const nodes = [];
  const links = [];
  const nodeMap = new Map();

  // First pass: create all nodes and determine generations
  const allBees = Object.keys(beeData);
  const generationMap = new Map();
  const visitedBees = new Set();

  // Find base bees (those with no parents)
  const baseBees = allBees.filter((bee) => {
    const beeInfo = beeData[bee];
    if (!beeInfo) {
      console.warn(`Missing bee data for: ${bee}`);
      return false;
    }
    if (!beeInfo.parentCombinations) {
      console.warn(`Missing parentCombinations for: ${bee}`);
      return true; // Treat as base bee
    }
    return beeInfo.parentCombinations.length === 0;
  });

  // Set base generation for base bees
  baseBees.forEach((bee) => {
    generationMap.set(bee, 0);
    visitedBees.add(bee);
  });

  // Iteratively assign generations based on parent relationships
  let changed = true;
  let iterations = 0;
  while (changed && iterations < 20) {
    iterations++;
    changed = false;
    allBees.forEach((bee) => {
      if (!visitedBees.has(bee)) {
        const beeInfo = beeData[bee];
        if (!beeInfo || !beeInfo.parentCombinations) {
          return; // Skip invalid entries
        }
        const parentCombinations = beeInfo.parentCombinations;
        if (parentCombinations.length > 0) {
          // Find the maximum generation among all possible parent combinations
          let maxParentGeneration = -1;
          let allParentsHaveGeneration = true;

          for (const parents of parentCombinations) {
            let combinationMaxGen = -1;
            let combinationValid = true;

            for (const parent of parents) {
              if (!generationMap.has(parent)) {
                combinationValid = false;
                break;
              }
              combinationMaxGen = Math.max(
                combinationMaxGen,
                generationMap.get(parent)
              );
            }

            if (combinationValid) {
              maxParentGeneration = Math.max(
                maxParentGeneration,
                combinationMaxGen
              );
            } else {
              allParentsHaveGeneration = false;
            }
          }

          if (maxParentGeneration >= 0 && allParentsHaveGeneration) {
            generationMap.set(bee, maxParentGeneration + 1);
            visitedBees.add(bee);
            changed = true;
          }
        }
      }
    });
  }

  // Create nodes with generation information
  allBees.forEach((bee) => {
    const generation = generationMap.get(bee) || 0;
    const translatedName = i18n ? i18n.getBeeName(bee) : null;
    const node = {
      id: bee,
      name: translatedName || beeData[bee].name || bee.split(":")[1] || bee,
      generation: generation,
      children: beeData[bee].children || [],
      parentCombinations: beeData[bee].parentCombinations || [],
      parents: [],
      mod: beeData[bee].mod || "Unknown",
    };

    // Flatten all parent combinations for display purposes
    const allParents = new Set();
    node.parentCombinations.forEach((combination) => {
      combination.forEach((parent) => allParents.add(parent));
    });
    node.parents = Array.from(allParents);

    nodes.push(node);
    nodeMap.set(bee, node);
  });

  // Create links for all parent-child relationships
  nodes.forEach((childNode) => {
    childNode.parentCombinations.forEach((parentPair) => {
      parentPair.forEach((parentId) => {
        if (nodeMap.has(parentId)) {
          links.push({
            source: parentId,
            target: childNode.id,
            type: "breeding",
          });
        }
      });
    });
  });

  return {
    nodes,
    links,
    nodeMap,
  };
}
