#!/usr/bin/env node
/**
 * Prepares the workspace packages for electron-builder packaging.
 * Copies workspace packages to node_modules since symlinks don't work in asar.
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const nodeModulesDir = path.join(rootDir, 'node_modules', '@mj-forge');

const workspacePackages = ['shared'];

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

console.log('Preparing workspace packages for packaging...');

for (const pkg of workspacePackages) {
  const srcDir = path.join(rootDir, 'packages', pkg);
  const destDir = path.join(nodeModulesDir, pkg);

  // Check if it's a symlink and remove it
  try {
    const stats = fs.lstatSync(destDir);
    if (stats.isSymbolicLink()) {
      console.log(`Removing symlink: ${destDir}`);
      fs.unlinkSync(destDir);
    } else if (stats.isDirectory()) {
      console.log(`Directory already exists: ${destDir}`);
      fs.rmSync(destDir, { recursive: true });
    }
  } catch (err) {
    // Path doesn't exist, that's fine
  }

  // Copy the package
  console.log(`Copying ${pkg} to node_modules/@mj-forge/${pkg}`);

  // Create destination directory
  fs.mkdirSync(destDir, { recursive: true });

  // Copy dist folder
  const distSrc = path.join(srcDir, 'dist');
  const distDest = path.join(destDir, 'dist');
  if (fs.existsSync(distSrc)) {
    copyDir(distSrc, distDest);
  }

  // Copy package.json
  const pkgJsonSrc = path.join(srcDir, 'package.json');
  const pkgJsonDest = path.join(destDir, 'package.json');
  if (fs.existsSync(pkgJsonSrc)) {
    fs.copyFileSync(pkgJsonSrc, pkgJsonDest);
  }
}

console.log('Workspace packages prepared successfully!');
