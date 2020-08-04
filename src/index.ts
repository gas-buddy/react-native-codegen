import fs from 'fs';
import yaml from 'js-yaml';
import prettier from 'prettier';

function normalize(spec: any) {
  return Object.entries(spec).map(([key, value]) => {
    if (!value) {
      return { jsName: key, path: key };
    } else if (typeof value === 'string') {
      return { jsName: key, path: value };
    }
    const { screens, name, ...rest } = value as any;

    if (Array.isArray(screens)) {
      rest.screens = normalize(
        screens.reduce((agg, entry) => {
          if (typeof entry === 'string') {
            agg[entry] = entry;
          } else if (typeof entry === 'object' && Object.keys(entry).length === 1) {
            agg[Object.keys(entry)[0]] = entry[Object.keys(entry)[0]];
          } else {
            console.log('Unknown screen entry format', entry);
          }
          return agg;
        }, {}),
      );
    } else if (screens) {
      rest.screens = normalize(screens);
    }

    return {
      jsName: key,
      path: name || key,
      ...rest,
    };
  });
}

function buildTypeAndLiteral(
  node: any,
  pathPrefix: string,
  typePrefix: string,
  typeLines: Array<string>,
  literalLines: Array<string>,
  paramLists: Array<any>,
) {
  node.forEach((entry: any) => {
    const pathValue = `${pathPrefix}${pathPrefix ? '.' : ''}${entry.path}`;
    if (entry.screens) {
      typeLines.push(`${entry.jsName}: {`);
      typeLines.push(`$name: '${pathValue}';`);
      literalLines.push(`${entry.jsName}: {`);
      literalLines.push(`$name: '${pathValue}',`);

      const newPathPrefix = pathPrefix ? `${pathPrefix}.${entry.path}` : entry.path;
      const newTypePrefix = typePrefix ? `${typePrefix}.${entry.jsName}` : entry.jsName;
      buildTypeAndLiteral(
        entry.screens,
        newPathPrefix,
        newTypePrefix,
        typeLines,
        literalLines,
        paramLists,
      );

      typeLines.push('};');
      literalLines.push('},');

      if (entry.parameterType) {
        paramLists.push({
          type: entry.type || 'stack',
          typeName: entry.parameterType,
          prefix: newTypePrefix,
          screens: entry.screens,
        });
      }
    } else {
      typeLines.push(`${entry.jsName}: '${pathValue}';`);
      literalLines.push(`${entry.jsName}: '${pathValue}',`);

      if (entry.parameterType) {
        paramLists.push({
          type: 'screen',
          typeName: entry.parameterType,
          extends: entry.extends,
          parameters: entry.parameters,
        });
      }
    }
  });
}

function getParameter({ name, type }: { name: string; type: string }) {
  if (type.endsWith('?')) {
    return `${name}?: ${type.substring(0, type.length - 1)};`;
  }
  return `${name}: ${type};`;
}

function getParameterType({
  type,
  typeName,
  extends: extendInterface,
  defaultParameters,
  prefix,
  screens,
  parameters,
}: any) {
  if (type === 'screen') {
    return [
      `export interface ${typeName} ${extendInterface ? `extends ${extendInterface} ` : ''}{`,
      ...parameters.map(getParameter),
      '}',
    ].join('\n');
  }
  return [
    `export type ${typeName} = {`,
    ...screens.map(
      (screen: any) =>
        `[Nav.${prefix}.${screen.jsName}]: ${
          screen.parameterType || defaultParameters || 'undefined'
        };`,
    ),
    '}',
  ].join('\n');
}

function imports(specs: Array<{ name: string; source: string; }>) {
  return specs.map(({ name, source }) => `import { ${name} } from '${source}';`);
}

export default async function BuildTypes(sourceFilename: string) {
  const spec: any = yaml.safeLoad(fs.readFileSync(sourceFilename, 'utf8'));

  const paramLists: Array<any> = [];
  const type: Array<string> = [];
  const literal: Array<string> = [];

  buildTypeAndLiteral(normalize(spec.screens), '', '', type, literal, paramLists);

  const output = `
  ${imports(spec.import).join('\n')}

  export interface NavType {
    ${type.join('\n')}
  }

  export const Nav: NavType = {
    ${literal.join('\n')}
  }

  ${paramLists
    .filter((p) => p.type === 'screen')
    .map(getParameterType)
    .join('\n')}

  ${paramLists
    .filter((p) => p.type !== 'screen')
    .map(getParameterType)
    .join('\n')}
  `;

  const options = await prettier.resolveConfig(sourceFilename);
  return prettier.format(output, { parser: 'typescript', ...options });
}