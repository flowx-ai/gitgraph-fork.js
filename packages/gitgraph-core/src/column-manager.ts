import { Branch } from './branch'
import { CompareBranchesOrder } from './branches-order'
import { Commit } from './commit'

export { ColumnManager }

type Color = string

interface BranchLifecycle {
  name: Branch['name']
  firstCommitIndex: number
  lastCommitIndex: number
  mergedAt?: number
  column?: number
  parentBranch?: Branch['name']
  parentCommitHash?: string
}

/**
 * Enhanced branch ordering that supports column reuse after branches are merged.
 * This replaces the standard BranchesOrder to optimize horizontal space usage.
 */
class ColumnManager<TNode> {
  private branches: Map<Branch['name'], BranchLifecycle> = new Map()
  private columnAssignments: Map<Branch['name'], number> = new Map()
  private colors: Color[]
  private commits: Array<Commit<TNode>>

  public constructor(
    commits: Array<Commit<TNode>>,
    colors: Color[],
    compareFunction: CompareBranchesOrder | undefined
  ) {
    this.colors = colors
    this.commits = commits

    // First pass: analyze branch lifecycles
    this.analyzeBranchLifecycles(commits)

    // Second pass: assign columns with reuse
    this.assignColumns(compareFunction)
  }

  /**
   * Return the column number for the given branch name.
   *
   * @param branchName Name of the branch
   */
  public get(branchName: Branch['name']): number {
    const assignment = this.columnAssignments.get(branchName)
    return assignment !== undefined ? assignment : 0
  }

  /**
   * Return the color of the given branch.
   *
   * @param branchName Name of the branch
   */
  public getColorOf(branchName: Branch['name']): Color {
    const column = this.get(branchName)
    return this.colors[column % this.colors.length]
  }

  /**
   * Analyze when each branch is created, active, and merged
   */
  private analyzeBranchLifecycles(commits: Array<Commit<TNode>>): void {
    commits.forEach((commit, index) => {
      const branchName = commit.branchToDisplay

      if (!this.branches.has(branchName)) {
        // Determine parent branch by looking at the previous commit
        let parentBranch: string | undefined
        let parentCommitHash: string | undefined
        if (index > 0) {
          // Look for the parent commit that this branch was created from
          parentCommitHash = commit.parents[0]
          if (parentCommitHash) {
            const parentCommit = commits.find((c, i) => i < index && c.hash === parentCommitHash)
            if (parentCommit) {
              parentBranch = parentCommit.branchToDisplay
            }
          }
        }

        this.branches.set(branchName, {
          name: branchName,
          firstCommitIndex: index,
          lastCommitIndex: index,
          parentBranch,
          parentCommitHash: parentCommitHash,
        })
      } else {
        const lifecycle = this.branches.get(branchName)
        if (lifecycle) {
          lifecycle.lastCommitIndex = index
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
            const mergedBranch = this.branches.get(parentCommit.branchToDisplay)
            if (mergedBranch && !mergedBranch.mergedAt) {
              mergedBranch.mergedAt = index
            }
          }
        })
      }
    })
  }

  /**
   * Assign columns to branches, reusing columns when possible
   */
  private assignColumns(compareFunction: CompareBranchesOrder | undefined): void {
    // Get branches sorted by their first appearance
    let sortedBranches = Array.from(this.branches.values()).sort(
      (a, b) => a.firstCommitIndex - b.firstCommitIndex
    )

    // Apply custom compare function if provided
    if (compareFunction) {
      sortedBranches = sortedBranches.sort((a, b) => compareFunction(a.name, b.name))
    }

    // Track which columns are free at each point
    const columnsInUse: Map<number, BranchLifecycle | null> = new Map()

    sortedBranches.forEach((branch) => {
      // Find the first available column
      let column = 0
      let foundColumn = false

      while (!foundColumn) {
        const occupant = columnsInUse.get(column)

        if (!occupant || this.canReuseColumn(occupant, branch)) {
          // Column is free or can be reused
          columnsInUse.set(column, branch)
          this.columnAssignments.set(branch.name, column)
          branch.column = column
          foundColumn = true
        } else {
          column++
        }
      }
    })
  }

  /**
   * Check if a column can be reused based on branch lifecycles
   */
  private canReuseColumn(occupant: BranchLifecycle, candidate: BranchLifecycle): boolean {
    // Never reuse the master/main branch column as it typically runs through the entire history
    if (occupant.name === 'master' || occupant.name === 'main') {
      return false
    }

    // Never reuse the column of the direct parent branch
    if (candidate.parentBranch === occupant.name) {
      return false
    }

    // Never reuse column if both branches start from the same parent commit
    // This ensures branches created from the same point get different columns
    if (candidate.parentCommitHash && 
        occupant.parentCommitHash &&
        candidate.parentCommitHash === occupant.parentCommitHash) {
      return false
    }

    // Can reuse if the occupant was merged before the candidate started
    if (occupant.mergedAt !== undefined && occupant.mergedAt < candidate.firstCommitIndex) {
      return true
    }

    // Can't reuse if the occupant hasn't been merged yet (still active/WIP)
    if (occupant.mergedAt === undefined) {
      return false
    }

    // Can reuse if there's no overlap in their active periods
    return occupant.lastCommitIndex < candidate.firstCommitIndex
  }
}