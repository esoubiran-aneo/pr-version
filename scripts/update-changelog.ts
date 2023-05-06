import { execSync } from 'node:child_process'
import { $fetch } from 'ofetch'
import { inc } from 'semver'
import { determineSemverChange, generateMarkDown, getGitDiff, loadChangelogConfig, parseCommits } from 'changelogen'
import { version } from '../package.json'

async function main() {
  const config = await loadChangelogConfig(process.cwd())

  const rawCommits = await getGitDiff(config.from, config.to)
  const commits = parseCommits(rawCommits, config).filter(
    c => config.types[c.type] && !(c.type === 'chore' && c.scope === 'deps' && !c.isBreaking),
  )

  const bumpType = determineSemverChange(commits, config)

  // Update version from package.json
  const newVersion = inc(version, bumpType || 'patch')
  const changelog = await generateMarkDown(commits, config)

  // Create and push a branch with bumped versions if it has not already been created
  const branchExists = execSync(`git ls-remote --heads origin v${newVersion}`).toString().trim().length > 0
  if (!branchExists) {
    execSync('git config --global user.email "esoubiran@aneo.fr"')
    execSync('git config --global user.name "esoubiran-aneo"')
    execSync(`git checkout -b v${newVersion}`)

    execSync(`npm version ${newVersion} --no-git-tag-version`)

    execSync(`git commit -am v${newVersion}`)
    execSync(`git push -u origin v${newVersion}`)
  }

  // Get the current PR for this release, if it exists
  const [currentPR] = await $fetch(`https://api.github.com/repos/esoubiran-aneo/pr-version/pulls?head=esoubiran-aneo:v${newVersion}`)

  const releaseNotes = [
    currentPR?.body.replace(/## 👉 Changelog[\s\S]*$/, '') || `> ${newVersion} is the next ${bumpType} release.\n>\n> **Timetable**: to be announced.`,
    '## 👉 Changelog',
    changelog.replace(/^## v.*?\n/, '').replace('...main', `...v${newVersion}`),
  ].join('\n')

  // Create a PR with release notes if none exists
  if (!currentPR) {
    return await $fetch('https://api.github.com/repos/esoubiran-aneo/pr-version/pulls', {
      method: 'POST',
      headers: {
        Authorization: `token ${process.env.GITHUB_TOKEN}`,
      },
      body: {
        title: `v${newVersion}`,
        head: `v${newVersion}`,
        base: 'main',
        body: releaseNotes,
        draft: true,
      },
    })
  }

  // Update release notes if the pull request does exist
  await $fetch(`https://api.github.com/repos/esoubiran-aneo/pr-version/pulls/${currentPR.number}`, {
    method: 'PATCH',
    headers: {
      Authorization: `token ${process.env.GITHUB_TOKEN}`,
    },
    body: {
      body: releaseNotes,
    },
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
