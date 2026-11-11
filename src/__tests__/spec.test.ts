import path from 'node:path';
import { NATIVE_MODULE_NAME } from '../constants';
import { createMockNative } from './mockNative';

// The Codegen parser is what the iOS and Android builds run on the spec. Parsing it here catches
// a spec Codegen would reject before a native build does.

const {
  TypeScriptParser,
} = require('@react-native/codegen/lib/parsers/typescript/parser');

const specFile = path.join(__dirname, '..', 'specs', 'NativePingfront.ts');

type ParsedModule = {
  type: string;
  moduleName: string;
  spec: {
    methods: Array<{ name: string }>;
    eventEmitters: Array<{ name: string }>;
  };
};

function parse(): Record<string, ParsedModule> {
  const schema = new TypeScriptParser().parseFile(specFile) as {
    modules: Record<string, ParsedModule>;
  };
  return schema.modules;
}

describe('Codegen spec', () => {
  it('parses as a Turbo Module named like NATIVE_MODULE_NAME', () => {
    const modules = Object.values(parse());
    expect(modules).toHaveLength(1);
    expect(modules[0]?.type).toBe('NativeModule');
    expect(modules[0]?.moduleName).toBe(NATIVE_MODULE_NAME);
  });

  it('matches the typed mock method for method', () => {
    const module = Object.values(parse())[0]!;
    const methods = module.spec.methods.map((m) => m.name).sort();
    const emitters = module.spec.eventEmitters.map((e) => e.name).sort();
    expect(emitters).toEqual([
      'onConversation',
      'onEvent',
      'onLinkRequest',
      'onLog',
      'onOfferRequest',
      'onScreenRequest',
      'onState',
      'onTeamAction',
    ]);
    const mock = createMockNative() as unknown as Record<string, unknown>;
    const mocked = Object.keys(mock)
      .filter((key) => typeof mock[key] === 'function')
      .filter((key) => !emitters.includes(key))
      .filter((key) => !['emit', 'listenerCount', 'reset'].includes(key))
      .sort();
    expect(mocked).toEqual(methods);
  });
});

describe('Codegen component spec', () => {
  const componentFile = path.join(
    __dirname,
    '..',
    'specs',
    'PingfrontChatViewNativeComponent.ts'
  );

  it('parses as the Fabric component PingfrontChatView with a string topic', () => {
    const schema = new TypeScriptParser().parseFile(componentFile) as {
      modules: Record<
        string,
        {
          type: string;
          components: Record<
            string,
            { props: Array<{ name: string; typeAnnotation: { type: string } }> }
          >;
        }
      >;
    };
    const modules = Object.values(schema.modules);
    expect(modules).toHaveLength(1);
    expect(modules[0]?.type).toBe('Component');
    const component = modules[0]?.components.PingfrontChatView;
    expect(component).toBeDefined();
    expect(component?.props).toEqual([
      expect.objectContaining({
        name: 'topic',
        typeAnnotation: expect.objectContaining({
          type: 'StringTypeAnnotation',
        }),
      }),
    ]);
  });

  it('is in the package Codegen config, with the iOS component provider', () => {
    const pkg = require('../../package.json') as {
      codegenConfig: {
        type: string;
        ios?: { componentProvider?: Record<string, string> };
      };
    };
    expect(pkg.codegenConfig.type).toBe('all');
    expect(pkg.codegenConfig.ios?.componentProvider).toEqual({
      PingfrontChatView: 'PingfrontChatViewComponentView',
    });
  });
});
