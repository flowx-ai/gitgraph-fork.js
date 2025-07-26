import { Branch } from "./branch";
import { CompareBranchesOrder } from "./branches-order";
import { Commit } from "./commit";

export { ColumnManager };

type Color = string;

interface BranchLifecycle {
  name: Branch["name"];
  firstCommitIndex: number;
  lastCommitIndex: number;
  mergedAt?: number;
  column?: number;
  parentBranch?: Branch["name"];
  parentCommitHash?: string;
}

/**
 * Enhanced branch ordering that supports column reuse after branches are merged.
 * This replaces the standard BranchesOrder to optimize horizontal space usage.
 */
class ColumnManager<TNode> {
  private branches: Map<Branch["name"], BranchLifecycle> = new Map();
  private columnAssignments: Map<Branch["name"], number> = new Map();
  private colors: Color[];

  public constructor(
    commits: Array<Commit<TNode>>,
    colors: Color[],
    compareFunction: CompareBranchesOrder | undefined,
  ) {
    this.colors = colors;

    // First pass: analyze branch lifecycles
    this.analyzeBranchLifecycles(commits);

    // Second pass: assign columns with reuse
    this.assignColumns(compareFunction);
  }

  /**
   * Return the column number for the given branch name.
   *
   * @param branchName Name of the branch
   */
  public get(branchName: Branch["name"]): number {
    const assignment = this.columnAssignments.get(branchName);
    return assignment !== undefined ? assignment : 0;
  }

  /**
   * Return the color of the given branch.
   *
   * @param branchName Name of the branch
   */
  public getColorOf(branchName: Branch["name"]): Color {
    const column = this.get(branchName);
    return this.colors[column % this.colors.length];
  }

  /**
   * Analyze when each branch is created, active, and merged
   */
  private analyzeBranchLifecycles(commits: Array<Commit<TNode>>): void {
    commits.forEach((commit, index) => {
      const branchName = commit.branchToDisplay;

      if (!this.branches.has(branchName)) {
        // Determine parent branch by looking at the previous commit
        let parentBranch: string | undefined;
        let parentCommitHash: string | undefined;
        if (index > 0 && commit.parents.length > 0) {
          // Look for the parent commit that this branch was created from
          parentCommitHash = commit.parents[0];
          if (parentCommitHash) {
            // Find the actual parent commit in the history
            const parentCommit = commits.find(
              (c, i) => i < index && c.hash === parentCommitHash,
            );
            if (parentCommit) {
              parentBranch = parentCommit.branchToDisplay;

              // Special case: if this is the first commit of a branch and the parent
              // has the same branch name (not a real branch creation), keep looking
              const prevCommit = index > 0 ? commits[index - 1] : null;
              if (
                prevCommit &&
                prevCommit.hash === parentCommitHash &&
                prevCommit.branchToDisplay !== branchName
              ) {
                // This is actually a branch creation from the previous commit's branch
                parentBranch = prevCommit.branchToDisplay;
              }
            }
          }
        }

        const lifecycle = {
          name: branchName,
          firstCommitIndex: index,
          lastCommitIndex: index,
          parentBranch,
          parentCommitHash: parentCommitHash,
        };

        this.branches.set(branchName, lifecycle);
      } else {
        const lifecycle = this.branches.get(branchName);
        if (lifecycle) {
          lifecycle.lastCommitIndex = index;
        }
      }

      // Check if this is a merge commit
      if (commit.parents.length > 1) {
        // Find branches that were merged
        commits.forEach((parentCommit, parentIndex) => {
          if (
            parentIndex < index &&
            commit.parents.includes(parentCommit.hash) &&
            parentCommit.branchToDisplay !== commit.branchToDisplay
          ) {
            const mergedBranch = this.branches.get(
              parentCommit.branchToDisplay,
            );
            if (mergedBranch && !mergedBranch.mergedAt) {
              mergedBranch.mergedAt = index;
            }
          }
        });
      }
    });
  }

  /**
   * Assign columns to branches, reusing columns when possible
   */
  private assignColumns(
    compareFunction: CompareBranchesOrder | undefined,
  ): void {
    // Get branches sorted by their first appearance
    let sortedBranches = Array.from(this.branches.values()).sort(
      (a, b) => a.firstCommitIndex - b.firstCommitIndex,
    );

    // Apply custom compare function if provided
    if (compareFunction) {
      sortedBranches = sortedBranches.sort((a, b) =>
        compareFunction(a.name, b.name),
      );
    }

    // Track which columns are occupied by which branches at any point in time
    const columnOccupancy: Map<number, BranchLifecycle[]> = new Map();

    sortedBranches.forEach((branch) => {
      // Main/master branch always gets column 0
      if (branch.name === "main" || branch.name === "master") {
        columnOccupancy.set(0, [branch]);
        this.columnAssignments.set(branch.name, 0);
        branch.column = 0;
        return;
      }

      // Find the first available column for other branches
      let column = 0;
      let foundColumn = false;

      while (!foundColumn) {
        const occupants = columnOccupancy.get(column) || [];

        if (occupants.length === 0) {
          columnOccupancy.set(column, [branch]);
          this.columnAssignments.set(branch.name, column);
          branch.column = column;
          foundColumn = true;
        } else {
          // Check if we can reuse this column (all occupants must be compatible)
          let canReuseColumn = true;
          for (const occupant of occupants) {
            if (!this.canReuseColumn(occupant, branch)) {
              canReuseColumn = false;
              break;
            }
          }

          if (canReuseColumn) {
            occupants.push(branch);
            columnOccupancy.set(column, occupants);
            this.columnAssignments.set(branch.name, column);
            branch.column = column;
            foundColumn = true;
          } else {
            column++;
          }
        }
      }
    });
  }

  /**
   * Check if a column can be reused based on branch lifecycles
   */
  private canReuseColumn(
    occupant: BranchLifecycle,
    candidate: BranchLifecycle,
  ): boolean {
    // Never reuse the master/main branch column as it typically runs through the entire history
    if (occupant.name === "master" || occupant.name === "main") {
      return false;
    }

    // Never reuse the column of the direct parent branch
    if (candidate.parentBranch === occupant.name) {
      return false;
    }

    // Never reuse column if both branches start from the same parent commit
    // This ensures branches created from the same point get different columns
    if (
      candidate.parentCommitHash &&
      occupant.parentCommitHash &&
      candidate.parentCommitHash === occupant.parentCommitHash
    ) {
      return false;
    }

    // Additional check: If branches have overlapping indices, they can't share a column
    // For visual purposes, a branch extends from its first commit to its merge point
    const candidateStart = candidate.firstCommitIndex;
    const candidateEnd =
      candidate.mergedAt !== undefined
        ? candidate.mergedAt
        : candidate.lastCommitIndex;
    const occupantStart = occupant.firstCommitIndex;
    const occupantEnd =
      occupant.mergedAt !== undefined
        ? occupant.mergedAt
        : occupant.lastCommitIndex;

    if (candidateStart <= occupantEnd && candidateEnd >= occupantStart) {
      return false;
    }

    // Check if there's no overlap in their active periods
    // A branch is active until its merge point (if merged) or assumed to continue indefinitely if not merged
    const occupantEndIndex =
      occupant.mergedAt !== undefined
        ? occupant.mergedAt
        : Number.MAX_SAFE_INTEGER;

    // Can reuse if the occupant ends before the candidate starts
    if (occupantEndIndex < candidate.firstCommitIndex) {
      return true;
    }

    // Cannot reuse if there's any overlap
    const hasOverlap = candidate.firstCommitIndex <= occupantEndIndex;
    if (hasOverlap) {
      return false;
    }

    return false;
  }
}
