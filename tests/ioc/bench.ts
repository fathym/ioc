import { IoCContainer } from '../../src/ioc/ioc.ts';
import { assert, assertEquals, assertInstanceOf, assertRejects } from '../test.deps.ts';

Deno.test('IoC Workbench', async (t) => {
  await t.step('Singleton - No Symbol - Unamed - Default', async () => {
    const ioc = new IoCContainer();

    ioc.Register(TestDefaultClass);

    const test = await ioc.Resolve(TestDefaultClass);

    assertEquals(test.Hello, 'World');
    assertInstanceOf(test, TestDefaultClass);

    const testb = await ioc.Resolve(TestDefaultClass);

    assertEquals(testb.Hello, 'World');
    assertInstanceOf(testb, TestDefaultClass);
    assert(testb === test, 'The singleton instance is not equal to the other.');
  });

  await t.step('Transient - No Symbol - Unamed - Default', async () => {
    const ioc = new IoCContainer();

    ioc.Register(TestDefaultClass, {
      Lifetime: 'transient',
    });

    const test = await ioc.Resolve(TestDefaultClass);

    assertEquals(test.Hello, 'World');
    assertInstanceOf(test, TestDefaultClass);

    const testb = await ioc.Resolve(TestDefaultClass);

    assertEquals(testb.Hello, 'World');
    assertInstanceOf(testb, TestDefaultClass);
    assert(testb !== test, 'The transient instance is equal to the other.');
  });

  await t.step('Scoped - No Symbol - Unamed - Default', async () => {
    const ioc = new IoCContainer();

    const iocScope = ioc.Register(TestDefaultClass, {
      Lifetime: 'scoped',
    })!;

    const test = await ioc.Resolve(TestDefaultClass);

    assertEquals(test.Hello, 'World');
    assertInstanceOf(test, TestDefaultClass);

    const testb = await ioc.Resolve(TestDefaultClass);

    assertEquals(testb.Hello, 'World');
    assertInstanceOf(testb, TestDefaultClass);
    assert(testb === test, 'The scoped instance is not equal to the other.');

    iocScope();

    await assertRejects(
      async () => {
        await ioc.Resolve(TestDefaultClass);
      },
      Error,
      'No Service for symbol',
      'The scoped instance was not destroyed.',
    );
  });

  await t.step('Singleton:Lazy - No Symbol - Unamed - Default', async () => {
    const ioc = new IoCContainer();

    ioc.Register(TestDefaultClass, {
      Lazy: true,
    });

    const test = await ioc.Resolve(TestDefaultClass);

    assertEquals(test.Hello, 'World');
    assertInstanceOf(test, TestDefaultClass);

    const testb = await ioc.Resolve(TestDefaultClass);

    assertEquals(testb.Hello, 'World');
    assertInstanceOf(testb, TestDefaultClass);
    assert(testb === test, 'The singleton instance is not equal to the other.');
  });

  await t.step('Transient:Lazy - No Symbol - Unamed - Default', async () => {
    const ioc = new IoCContainer();

    ioc.Register(TestDefaultClass, {
      Lazy: true,
      Lifetime: 'transient',
    });

    const test = await ioc.Resolve(TestDefaultClass);

    assertEquals(test.Hello, 'World');
    assertInstanceOf(test, TestDefaultClass);

    const testb = await ioc.Resolve(TestDefaultClass);

    assertEquals(testb.Hello, 'World');
    assertInstanceOf(testb, TestDefaultClass);
    assert(testb !== test, 'The transient instance is equal to the other.');
  });

  await t.step('Scoped:Lazy - No Symbol - Unamed - Default', async () => {
    const ioc = new IoCContainer();

    const iocScope = ioc.Register(TestDefaultClass, {
      Lazy: true,
      Lifetime: 'scoped',
    })!;

    const test = await ioc.Resolve(TestDefaultClass);

    assertEquals(test.Hello, 'World');
    assertInstanceOf(test, TestDefaultClass);

    const testb = await ioc.Resolve(TestDefaultClass);

    assertEquals(testb.Hello, 'World');
    assertInstanceOf(testb, TestDefaultClass);
    assert(testb === test, 'The scoped instance is not equal to the other.');

    iocScope();

    await assertRejects(
      async () => {
        await ioc.Resolve(TestDefaultClass);
      },
      Error,
      'No Service for symbol',
      'The scoped instance was not destroyed.',
    );
  });

  await t.step('Singleton - Symbol - Unamed - Default', async () => {
    const ioc = new IoCContainer();

    ioc.Register(TestDefaultClass, {
      Type: ioc.Symbol($ITestClass),
    });

    const test = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));

    assertEquals(test.Hello, 'World');
    assertInstanceOf(test, TestDefaultClass);

    const testb = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));

    assertEquals(testb.Hello, 'World');
    assertInstanceOf(testb, TestDefaultClass);
    assert(testb === test, 'The singleton instance is not equal to the other.');
  });

  await t.step('Transient - Symbol - Unamed - Default', async () => {
    const ioc = new IoCContainer();

    ioc.Register(TestDefaultClass, {
      Lifetime: 'transient',
      Type: ioc.Symbol($ITestClass),
    });

    const test = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));

    assertEquals(test.Hello, 'World');
    assertInstanceOf(test, TestDefaultClass);

    const testb = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));

    assertEquals(testb.Hello, 'World');
    assertInstanceOf(testb, TestDefaultClass);
    assert(testb !== test, 'The transient instance is equal to the other.');
  });

  await t.step('Scoped - Symbol - Unamed - Default', async () => {
    const ioc = new IoCContainer();

    const iocScope = ioc.Register(TestDefaultClass, {
      Lifetime: 'scoped',
      Type: ioc.Symbol($ITestClass),
    })!;

    const test = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));

    assertEquals(test.Hello, 'World');
    assertInstanceOf(test, TestDefaultClass);

    const testb = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));

    assertEquals(testb.Hello, 'World');
    assertInstanceOf(testb, TestDefaultClass);
    assert(testb === test, 'The scoped instance is not equal to the other.');

    iocScope();

    await assertRejects(
      async () => {
        await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));
      },
      Error,
      'No Service for symbol',
      'The scoped instance was not destroyed.',
    );
  });

  await t.step('Singleton:Lazy - Symbol - Unamed - Default', async () => {
    const ioc = new IoCContainer();

    ioc.Register(TestDefaultClass, {
      Lazy: true,
      Type: ioc.Symbol($ITestClass),
    });

    const test = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));

    assertEquals(test.Hello, 'World');
    assertInstanceOf(test, TestDefaultClass);

    const testb = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));

    assertEquals(testb.Hello, 'World');
    assertInstanceOf(testb, TestDefaultClass);
    assert(testb === test, 'The singleton instance is not equal to the other.');
  });

  await t.step('Transient:Lazy - Symbol - Unamed - Default', async () => {
    const ioc = new IoCContainer();

    ioc.Register(TestDefaultClass, {
      Lazy: true,
      Lifetime: 'transient',
      Type: ioc.Symbol($ITestClass),
    });

    const test = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));

    assertEquals(test.Hello, 'World');
    assertInstanceOf(test, TestDefaultClass);

    const testb = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));

    assertEquals(testb.Hello, 'World');
    assertInstanceOf(testb, TestDefaultClass);
    assert(testb !== test, 'The transient instance is equal to the other.');
  });

  await t.step('Scoped:Lazy - Symbol - Unamed - Default', async () => {
    const ioc = new IoCContainer();

    const iocScope = ioc.Register(TestDefaultClass, {
      Lazy: true,
      Lifetime: 'scoped',
      Type: ioc.Symbol($ITestClass),
    })!;

    const test = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));

    assertEquals(test.Hello, 'World');
    assertInstanceOf(test, TestDefaultClass);

    const testb = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));

    assertEquals(testb.Hello, 'World');
    assertInstanceOf(testb, TestDefaultClass);
    assert(testb === test, 'The scoped instance is not equal to the other.');

    iocScope();

    await assertRejects(
      async () => {
        await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));
      },
      Error,
      'No Service for symbol',
      'The scoped instance was not destroyed.',
    );
  });

  await t.step('Singleton - No Symbol - Named - Default', async () => {
    const ioc = new IoCContainer();

    ioc.Register(TestDefaultClass, {
      Name: 'test',
    });

    const test = await ioc.Resolve(TestDefaultClass, 'test');

    assertEquals(test.Hello, 'World');
    assertInstanceOf(test, TestDefaultClass);

    const testb = await ioc.Resolve(TestDefaultClass, 'test');

    assertEquals(testb.Hello, 'World');
    assertInstanceOf(testb, TestDefaultClass);
    assert(testb === test, 'The singleton instance is not equal to the other.');
  });

  await t.step('Transient - No Symbol - Named - Default', async () => {
    const ioc = new IoCContainer();

    ioc.Register(TestDefaultClass, {
      Lifetime: 'transient',
      Name: 'test',
    });

    const test = await ioc.Resolve(TestDefaultClass, 'test');

    assertEquals(test.Hello, 'World');
    assertInstanceOf(test, TestDefaultClass);

    const testb = await ioc.Resolve(TestDefaultClass, 'test');

    assertEquals(testb.Hello, 'World');
    assertInstanceOf(testb, TestDefaultClass);
    assert(testb !== test, 'The transient instance is equal to the other.');
  });

  await t.step('Scoped - No Symbol - Named - Default', async () => {
    const ioc = new IoCContainer();

    const iocScope = ioc.Register(TestDefaultClass, {
      Lifetime: 'scoped',
      Name: 'test',
    })!;

    const test = await ioc.Resolve(TestDefaultClass, 'test');

    assertEquals(test.Hello, 'World');
    assertInstanceOf(test, TestDefaultClass);

    const testb = await ioc.Resolve(TestDefaultClass, 'test');

    assertEquals(testb.Hello, 'World');
    assertInstanceOf(testb, TestDefaultClass);
    assert(testb === test, 'The scoped instance is not equal to the other.');

    iocScope();

    await assertRejects(
      async () => {
        await ioc.Resolve(TestDefaultClass, 'test');
      },
      Error,
      'No Service for symbol',
      'The scoped instance was not destroyed.',
    );
  });

  await t.step('Singleton:Lazy - No Symbol - Named - Default', async () => {
    const ioc = new IoCContainer();

    ioc.Register(TestDefaultClass, {
      Lazy: true,
      Name: 'test',
    });

    const test = await ioc.Resolve(TestDefaultClass, 'test');

    assertEquals(test.Hello, 'World');
    assertInstanceOf(test, TestDefaultClass);

    const testb = await ioc.Resolve(TestDefaultClass, 'test');

    assertEquals(testb.Hello, 'World');
    assertInstanceOf(testb, TestDefaultClass);
    assert(testb === test, 'The singleton instance is not equal to the other.');
  });

  await t.step('Transient:Lazy - No Symbol - Named - Default', async () => {
    const ioc = new IoCContainer();

    ioc.Register(TestDefaultClass, {
      Lazy: true,
      Lifetime: 'transient',
      Name: 'test',
    });

    const test = await ioc.Resolve(TestDefaultClass, 'test');

    assertEquals(test.Hello, 'World');
    assertInstanceOf(test, TestDefaultClass);

    const testb = await ioc.Resolve(TestDefaultClass, 'test');

    assertEquals(testb.Hello, 'World');
    assertInstanceOf(testb, TestDefaultClass);
    assert(testb !== test, 'The transient instance is equal to the other.');
  });

  await t.step('Scoped:Lazy - No Symbol - Named - Default', async () => {
    const ioc = new IoCContainer();

    const iocScope = ioc.Register(TestDefaultClass, {
      Lazy: true,
      Lifetime: 'scoped',
      Name: 'test',
    })!;

    const test = await ioc.Resolve(TestDefaultClass, 'test');

    assertEquals(test.Hello, 'World');
    assertInstanceOf(test, TestDefaultClass);

    const testb = await ioc.Resolve(TestDefaultClass, 'test');

    assertEquals(testb.Hello, 'World');
    assertInstanceOf(testb, TestDefaultClass);
    assert(testb === test, 'The scoped instance is not equal to the other.');

    iocScope();

    await assertRejects(
      async () => {
        await ioc.Resolve(TestDefaultClass, 'test');
      },
      Error,
      'No Service for symbol',
      'The scoped instance was not destroyed.',
    );
  });

  await t.step('Singleton - Symbol - Named - Default', async () => {
    const ioc = new IoCContainer();

    ioc.Register(TestDefaultClass, {
      Name: 'test',
      Type: ioc.Symbol($ITestClass),
    });

    const test = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass), 'test');

    assertEquals(test.Hello, 'World');
    assertInstanceOf(test, TestDefaultClass);

    const testb = await ioc.Resolve<ITestClass>(
      ioc.Symbol($ITestClass),
      'test',
    );

    assertEquals(testb.Hello, 'World');
    assertInstanceOf(testb, TestDefaultClass);
    assert(testb === test, 'The singleton instance is not equal to the other.');
  });

  await t.step('Transient - Symbol - Named - Default', async () => {
    const ioc = new IoCContainer();

    ioc.Register(TestDefaultClass, {
      Lifetime: 'transient',
      Name: 'test',
      Type: ioc.Symbol($ITestClass),
    });

    const test = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass), 'test');

    assertEquals(test.Hello, 'World');
    assertInstanceOf(test, TestDefaultClass);

    const testb = await ioc.Resolve<ITestClass>(
      ioc.Symbol($ITestClass),
      'test',
    );

    assertEquals(testb.Hello, 'World');
    assertInstanceOf(testb, TestDefaultClass);
    assert(testb !== test, 'The transient instance is equal to the other.');
  });

  await t.step('Scoped - Symbol - Named - Default', async () => {
    const ioc = new IoCContainer();

    const iocScope = ioc.Register(TestDefaultClass, {
      Lifetime: 'scoped',
      Name: 'test',
      Type: ioc.Symbol($ITestClass),
    })!;

    const test = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass), 'test');

    assertEquals(test.Hello, 'World');
    assertInstanceOf(test, TestDefaultClass);

    const testb = await ioc.Resolve<ITestClass>(
      ioc.Symbol($ITestClass),
      'test',
    );

    assertEquals(testb.Hello, 'World');
    assertInstanceOf(testb, TestDefaultClass);
    assert(testb === test, 'The scoped instance is not equal to the other.');

    iocScope();

    await assertRejects(
      async () => {
        await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass)), 'test';
      },
      Error,
      'No Service for symbol',
      'The scoped instance was not destroyed.',
    );
  });

  await t.step('Singleton:Lazy - Symbol - Named - Default', async () => {
    const ioc = new IoCContainer();

    ioc.Register(TestDefaultClass, {
      Lazy: true,
      Name: 'test',
      Type: ioc.Symbol($ITestClass),
    });

    const test = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass), 'test');

    assertEquals(test.Hello, 'World');
    assertInstanceOf(test, TestDefaultClass);

    const testb = await ioc.Resolve<ITestClass>(
      ioc.Symbol($ITestClass),
      'test',
    );

    assertEquals(testb.Hello, 'World');
    assertInstanceOf(testb, TestDefaultClass);
    assert(testb === test, 'The singleton instance is not equal to the other.');
  });

  await t.step('Transient:Lazy - Symbol - Named - Default', async () => {
    const ioc = new IoCContainer();

    ioc.Register(TestDefaultClass, {
      Lazy: true,
      Lifetime: 'transient',
      Name: 'test',
      Type: ioc.Symbol($ITestClass),
    });

    const test = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass), 'test');

    assertEquals(test.Hello, 'World');
    assertInstanceOf(test, TestDefaultClass);

    const testb = await ioc.Resolve<ITestClass>(
      ioc.Symbol($ITestClass),
      'test',
    );

    assertEquals(testb.Hello, 'World');
    assertInstanceOf(testb, TestDefaultClass);
    assert(testb !== test, 'The transient instance is equal to the other.');
  });

  await t.step('Scoped:Lazy - Symbol - Named - Default', async () => {
    const ioc = new IoCContainer();

    const iocScope = ioc.Register(TestDefaultClass, {
      Lazy: true,
      Lifetime: 'scoped',
      Name: 'test',
      Type: ioc.Symbol($ITestClass),
    })!;

    const test = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass), 'test');

    assertEquals(test.Hello, 'World');
    assertInstanceOf(test, TestDefaultClass);

    const testb = await ioc.Resolve<ITestClass>(
      ioc.Symbol($ITestClass),
      'test',
    );

    assertEquals(testb.Hello, 'World');
    assertInstanceOf(testb, TestDefaultClass);
    assert(testb === test, 'The scoped instance is not equal to the other.');

    iocScope();

    await assertRejects(
      async () => {
        await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass), 'test');
      },
      Error,
      'No Service for symbol',
      'The scoped instance was not destroyed.',
    );
  });

  await t.step('Singleton - No Symbol - Unamed - Params', async () => {
    const ioc = new IoCContainer();

    ioc.Register(TestParamsClass, () => new TestParamsClass('World2'));

    const test = await ioc.Resolve(TestParamsClass);

    assertEquals(test.Hello, 'World2');
    assertInstanceOf(test, TestParamsClass);

    const testb = await ioc.Resolve(TestParamsClass);

    assertEquals(testb.Hello, 'World2');
    assertInstanceOf(testb, TestParamsClass);
    assert(testb === test, 'The singleton instance is not equal to the other.');
  });

  await t.step('Transient - No Symbol - Unamed - Params', async () => {
    const ioc = new IoCContainer();

    ioc.Register(TestParamsClass, () => new TestParamsClass('World2'), {
      Lifetime: 'transient',
    });

    const test = await ioc.Resolve(TestParamsClass);

    assertEquals(test.Hello, 'World2');
    assertInstanceOf(test, TestParamsClass);

    const testb = await ioc.Resolve(TestParamsClass);

    assertEquals(testb.Hello, 'World2');
    assertInstanceOf(testb, TestParamsClass);
    assert(testb !== test, 'The transient instance is equal to the other.');
  });

  await t.step('Scoped - No Symbol - Unamed - Params', async () => {
    const ioc = new IoCContainer();

    const iocScope = ioc.Register(
      TestParamsClass,
      () => new TestParamsClass('World2'),
      {
        Lifetime: 'scoped',
      },
    )!;

    const test = await ioc.Resolve(TestParamsClass);

    assertEquals(test.Hello, 'World2');
    assertInstanceOf(test, TestParamsClass);

    const testb = await ioc.Resolve(TestParamsClass);

    assertEquals(testb.Hello, 'World2');
    assertInstanceOf(testb, TestParamsClass);
    assert(testb === test, 'The scoped instance is not equal to the other.');

    iocScope();

    await assertRejects(
      async () => {
        await ioc.Resolve(TestParamsClass);
      },
      Error,
      'No Service for symbol',
      'The scoped instance was not destroyed.',
    );
  });

  await t.step('Singleton:Lazy - No Symbol - Unamed - Params', async () => {
    const ioc = new IoCContainer();

    ioc.Register(TestParamsClass, () => new TestParamsClass('World2'), {
      Lazy: true,
    });

    const test = await ioc.Resolve(TestParamsClass);

    assertEquals(test.Hello, 'World2');
    assertInstanceOf(test, TestParamsClass);

    const testb = await ioc.Resolve(TestParamsClass);

    assertEquals(testb.Hello, 'World2');
    assertInstanceOf(testb, TestParamsClass);
    assert(testb === test, 'The singleton instance is not equal to the other.');
  });

  await t.step('Transient:Lazy - No Symbol - Unamed - Params', async () => {
    const ioc = new IoCContainer();

    ioc.Register(TestParamsClass, () => new TestParamsClass('World2'), {
      Lazy: true,
      Lifetime: 'transient',
    });

    const test = await ioc.Resolve(TestParamsClass);

    assertEquals(test.Hello, 'World2');
    assertInstanceOf(test, TestParamsClass);

    const testb = await ioc.Resolve(TestParamsClass);

    assertEquals(testb.Hello, 'World2');
    assertInstanceOf(testb, TestParamsClass);
    assert(testb !== test, 'The transient instance is equal to the other.');
  });

  await t.step('Scoped:Lazy - No Symbol - Unamed - Params', async () => {
    const ioc = new IoCContainer();

    const iocScope = ioc.Register(
      TestParamsClass,
      () => new TestParamsClass('World2'),
      {
        Lazy: true,
        Lifetime: 'scoped',
      },
    )!;

    const test = await ioc.Resolve(TestParamsClass);

    assertEquals(test.Hello, 'World2');
    assertInstanceOf(test, TestParamsClass);

    const testb = await ioc.Resolve(TestParamsClass);

    assertEquals(testb.Hello, 'World2');
    assertInstanceOf(testb, TestParamsClass);
    assert(testb === test, 'The scoped instance is not equal to the other.');

    iocScope();

    await assertRejects(
      async () => {
        await ioc.Resolve(TestParamsClass);
      },
      Error,
      'No Service for symbol',
      'The scoped instance was not destroyed.',
    );
  });

  await t.step('Singleton - Symbol - Unamed - Params', async () => {
    const ioc = new IoCContainer();

    ioc.Register(() => new TestParamsClass('World2'), {
      Type: ioc.Symbol($ITestClass),
    });

    const test = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));

    assertEquals(test.Hello, 'World2');
    assertInstanceOf(test, TestParamsClass);

    const testb = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));

    assertEquals(testb.Hello, 'World2');
    assertInstanceOf(testb, TestParamsClass);
    assert(testb === test, 'The singleton instance is not equal to the other.');
  });

  await t.step('Transient - Symbol - Unamed - Params', async () => {
    const ioc = new IoCContainer();

    ioc.Register(() => new TestParamsClass('World2'), {
      Lifetime: 'transient',
      Type: ioc.Symbol($ITestClass),
    });

    const test = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));

    assertEquals(test.Hello, 'World2');
    assertInstanceOf(test, TestParamsClass);

    const testb = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));

    assertEquals(testb.Hello, 'World2');
    assertInstanceOf(testb, TestParamsClass);
    assert(testb !== test, 'The transient instance is equal to the other.');
  });

  await t.step('Scoped - Symbol - Unamed - Params', async () => {
    const ioc = new IoCContainer();

    const iocScope = ioc.Register(() => new TestParamsClass('World2'), {
      Lifetime: 'scoped',
      Type: ioc.Symbol($ITestClass),
    })!;

    const test = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));

    assertEquals(test.Hello, 'World2');
    assertInstanceOf(test, TestParamsClass);

    const testb = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));

    assertEquals(testb.Hello, 'World2');
    assertInstanceOf(testb, TestParamsClass);
    assert(testb === test, 'The scoped instance is not equal to the other.');

    iocScope();

    await assertRejects(
      async () => {
        await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));
      },
      Error,
      'No Service for symbol',
      'The scoped instance was not destroyed.',
    );
  });

  await t.step('Singleton:Lazy - Symbol - Unamed - Params', async () => {
    const ioc = new IoCContainer();

    ioc.Register(() => new TestParamsClass('World2'), {
      Lazy: true,
      Type: ioc.Symbol($ITestClass),
    });

    const test = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));

    assertEquals(test.Hello, 'World2');
    assertInstanceOf(test, TestParamsClass);

    const testb = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));

    assertEquals(testb.Hello, 'World2');
    assertInstanceOf(testb, TestParamsClass);
    assert(testb === test, 'The singleton instance is not equal to the other.');
  });

  await t.step('Transient:Lazy - Symbol - Unamed - Params', async () => {
    const ioc = new IoCContainer();

    ioc.Register(() => new TestParamsClass('World2'), {
      Lazy: true,
      Lifetime: 'transient',
      Type: ioc.Symbol($ITestClass),
    });

    const test = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));

    assertEquals(test.Hello, 'World2');
    assertInstanceOf(test, TestParamsClass);

    const testb = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));

    assertEquals(testb.Hello, 'World2');
    assertInstanceOf(testb, TestParamsClass);
    assert(testb !== test, 'The transient instance is equal to the other.');
  });

  await t.step('Scoped:Lazy - Symbol - Unamed - Params', async () => {
    const ioc = new IoCContainer();

    const iocScope = ioc.Register(() => new TestParamsClass('World2'), {
      Lazy: true,
      Lifetime: 'scoped',
      Type: ioc.Symbol($ITestClass),
    })!;

    const test = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));

    assertEquals(test.Hello, 'World2');
    assertInstanceOf(test, TestParamsClass);

    const testb = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));

    assertEquals(testb.Hello, 'World2');
    assertInstanceOf(testb, TestParamsClass);
    assert(testb === test, 'The scoped instance is not equal to the other.');

    iocScope();

    await assertRejects(
      async () => {
        await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));
      },
      Error,
      'No Service for symbol',
      'The scoped instance was not destroyed.',
    );
  });

  await t.step('Singleton - No Symbol - Named - Params', async () => {
    const ioc = new IoCContainer();

    ioc.Register(TestParamsClass, () => new TestParamsClass('World2'), {
      Name: 'test',
    });

    const test = await ioc.Resolve(TestParamsClass, 'test');

    assertEquals(test.Hello, 'World2');
    assertInstanceOf(test, TestParamsClass);

    const testb = await ioc.Resolve(TestParamsClass, 'test');

    assertEquals(testb.Hello, 'World2');
    assertInstanceOf(testb, TestParamsClass);
    assert(testb === test, 'The singleton instance is not equal to the other.');
  });

  await t.step('Transient - No Symbol - Named - Params', async () => {
    const ioc = new IoCContainer();

    ioc.Register(TestParamsClass, () => new TestParamsClass('World2'), {
      Lifetime: 'transient',
      Name: 'test',
    });

    const test = await ioc.Resolve(TestParamsClass, 'test');

    assertEquals(test.Hello, 'World2');
    assertInstanceOf(test, TestParamsClass);

    const testb = await ioc.Resolve(TestParamsClass, 'test');

    assertEquals(testb.Hello, 'World2');
    assertInstanceOf(testb, TestParamsClass);
    assert(testb !== test, 'The transient instance is equal to the other.');
  });

  await t.step('Scoped - No Symbol - Named - Params', async () => {
    const ioc = new IoCContainer();

    const iocScope = ioc.Register(
      TestParamsClass,
      () => new TestParamsClass('World2'),
      {
        Lifetime: 'scoped',
        Name: 'test',
      },
    )!;

    const test = await ioc.Resolve(TestParamsClass, 'test');

    assertEquals(test.Hello, 'World2');
    assertInstanceOf(test, TestParamsClass);

    const testb = await ioc.Resolve(TestParamsClass, 'test');

    assertEquals(testb.Hello, 'World2');
    assertInstanceOf(testb, TestParamsClass);
    assert(testb === test, 'The scoped instance is not equal to the other.');

    iocScope();

    await assertRejects(
      async () => {
        await ioc.Resolve(TestParamsClass, 'test');
      },
      Error,
      'No Service for symbol',
      'The scoped instance was not destroyed.',
    );
  });

  await t.step('Singleton:Lazy - No Symbol - Named - Params', async () => {
    const ioc = new IoCContainer();

    ioc.Register(TestParamsClass, () => new TestParamsClass('World2'), {
      Lazy: true,
      Name: 'test',
    });

    const test = await ioc.Resolve(TestParamsClass, 'test');

    assertEquals(test.Hello, 'World2');
    assertInstanceOf(test, TestParamsClass);

    const testb = await ioc.Resolve(TestParamsClass, 'test');

    assertEquals(testb.Hello, 'World2');
    assertInstanceOf(testb, TestParamsClass);
    assert(testb === test, 'The singleton instance is not equal to the other.');
  });

  await t.step('Transient:Lazy - No Symbol - Named - Params', async () => {
    const ioc = new IoCContainer();

    ioc.Register(TestParamsClass, () => new TestParamsClass('World2'), {
      Lazy: true,
      Lifetime: 'transient',
      Name: 'test',
    });

    const test = await ioc.Resolve(TestParamsClass, 'test');

    assertEquals(test.Hello, 'World2');
    assertInstanceOf(test, TestParamsClass);

    const testb = await ioc.Resolve(TestParamsClass, 'test');

    assertEquals(testb.Hello, 'World2');
    assertInstanceOf(testb, TestParamsClass);
    assert(testb !== test, 'The transient instance is equal to the other.');
  });

  await t.step('Scoped:Lazy - No Symbol - Named - Params', async () => {
    const ioc = new IoCContainer();

    const iocScope = ioc.Register(
      TestParamsClass,
      () => new TestParamsClass('World2'),
      {
        Lazy: true,
        Lifetime: 'scoped',
        Name: 'test',
      },
    )!;

    const test = await ioc.Resolve(TestParamsClass, 'test');

    assertEquals(test.Hello, 'World2');
    assertInstanceOf(test, TestParamsClass);

    const testb = await ioc.Resolve(TestParamsClass, 'test');

    assertEquals(testb.Hello, 'World2');
    assertInstanceOf(testb, TestParamsClass);
    assert(testb === test, 'The scoped instance is not equal to the other.');

    iocScope();

    await assertRejects(
      async () => {
        await ioc.Resolve(TestParamsClass, 'test');
      },
      Error,
      'No Service for symbol',
      'The scoped instance was not destroyed.',
    );
  });

  await t.step('Singleton - Symbol - Named - Params', async () => {
    const ioc = new IoCContainer();

    ioc.Register(() => new TestParamsClass('World2'), {
      Name: 'test',
      Type: ioc.Symbol($ITestClass),
    });

    const test = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass), 'test');

    assertEquals(test.Hello, 'World2');
    assertInstanceOf(test, TestParamsClass);

    const testb = await ioc.Resolve<ITestClass>(
      ioc.Symbol($ITestClass),
      'test',
    );

    assertEquals(testb.Hello, 'World2');
    assertInstanceOf(testb, TestParamsClass);
    assert(testb === test, 'The singleton instance is not equal to the other.');
  });

  await t.step('Transient - Symbol - Named - Params', async () => {
    const ioc = new IoCContainer();

    ioc.Register(() => new TestParamsClass('World2'), {
      Lifetime: 'transient',
      Name: 'test',
      Type: ioc.Symbol($ITestClass),
    });

    const test = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass), 'test');

    assertEquals(test.Hello, 'World2');
    assertInstanceOf(test, TestParamsClass);

    const testb = await ioc.Resolve<ITestClass>(
      ioc.Symbol($ITestClass),
      'test',
    );

    assertEquals(testb.Hello, 'World2');
    assertInstanceOf(testb, TestParamsClass);
    assert(testb !== test, 'The transient instance is equal to the other.');
  });

  await t.step('Scoped - Symbol - Named - Params', async () => {
    const ioc = new IoCContainer();

    const iocScope = ioc.Register(() => new TestParamsClass('World2'), {
      Lifetime: 'scoped',
      Name: 'test',
      Type: ioc.Symbol($ITestClass),
    })!;

    const test = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass), 'test');

    assertEquals(test.Hello, 'World2');
    assertInstanceOf(test, TestParamsClass);

    const testb = await ioc.Resolve<ITestClass>(
      ioc.Symbol($ITestClass),
      'test',
    );

    assertEquals(testb.Hello, 'World2');
    assertInstanceOf(testb, TestParamsClass);
    assert(testb === test, 'The scoped instance is not equal to the other.');

    iocScope();

    await assertRejects(
      async () => {
        await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass), 'test');
      },
      Error,
      'No Service for symbol',
      'The scoped instance was not destroyed.',
    );
  });

  await t.step('Singleton:Lazy - Symbol - Named - Params', async () => {
    const ioc = new IoCContainer();

    ioc.Register(() => new TestParamsClass('World2'), {
      Lazy: true,
      Name: 'test',
      Type: ioc.Symbol($ITestClass),
    });

    const test = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass), 'test');

    assertEquals(test.Hello, 'World2');
    assertInstanceOf(test, TestParamsClass);

    const testb = await ioc.Resolve<ITestClass>(
      ioc.Symbol($ITestClass),
      'test',
    );

    assertEquals(testb.Hello, 'World2');
    assertInstanceOf(testb, TestParamsClass);
    assert(testb === test, 'The singleton instance is not equal to the other.');
  });

  await t.step('Transient:Lazy - Symbol - Named - Params', async () => {
    const ioc = new IoCContainer();

    ioc.Register(() => new TestParamsClass('World2'), {
      Lazy: true,
      Lifetime: 'transient',
      Name: 'test',
      Type: ioc.Symbol($ITestClass),
    });

    const test = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass), 'test');

    assertEquals(test.Hello, 'World2');
    assertInstanceOf(test, TestParamsClass);

    const testb = await ioc.Resolve<ITestClass>(
      ioc.Symbol($ITestClass),
      'test',
    );

    assertEquals(testb.Hello, 'World2');
    assertInstanceOf(testb, TestParamsClass);
    assert(testb !== test, 'The transient instance is equal to the other.');
  });

  await t.step('Scoped:Lazy - Symbol - Named - Params', async () => {
    const ioc = new IoCContainer();

    const iocScope = ioc.Register(() => new TestParamsClass('World2'), {
      Lazy: true,
      Lifetime: 'scoped',
      Name: 'test',
      Type: ioc.Symbol($ITestClass),
    })!;

    const test = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass), 'test');

    assertEquals(test.Hello, 'World2');
    assertInstanceOf(test, TestParamsClass);

    const testb = await ioc.Resolve<ITestClass>(
      ioc.Symbol($ITestClass),
      'test',
    );

    assertEquals(testb.Hello, 'World2');
    assertInstanceOf(testb, TestParamsClass);
    assert(testb === test, 'The scoped instance is not equal to the other.');

    iocScope();

    await assertRejects(
      async () => {
        await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass), 'test');
      },
      Error,
      'No Service for symbol',
      'The scoped instance was not destroyed.',
    );
  });

  await t.step('Clash Checks - Singletons - Params', async () => {
    const ioc = new IoCContainer();

    ioc.Register(TestParamsClass, () => new TestParamsClass('World2'));

    ioc.Register(TestParamsClass, () => new TestParamsClass('World3'), {
      Name: 'test',
    });

    ioc.Register(() => new TestParamsClass('World4'), {
      Type: ioc.Symbol($ITestClass),
    });

    ioc.Register(() => new TestParamsClass('World5'), {
      Name: 'test',
      Type: ioc.Symbol($ITestClass),
    });

    const test = await ioc.Resolve<TestParamsClass>(TestParamsClass);

    assertEquals(test.Hello, 'World2');
    assertInstanceOf(test, TestParamsClass);

    const testName = await ioc.Resolve<TestParamsClass>(
      TestParamsClass,
      'test',
    );

    assertEquals(testName.Hello, 'World3');
    assertInstanceOf(testName, TestParamsClass);

    const testSymbol = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));

    assertEquals(testSymbol.Hello, 'World4');
    assertInstanceOf(testSymbol, TestParamsClass);

    const testSymbolName = await ioc.Resolve<ITestClass>(
      ioc.Symbol($ITestClass),
      'test',
    );

    assertEquals(testSymbolName.Hello, 'World5');
    assertInstanceOf(testSymbolName, TestParamsClass);
  });

  await t.step('Clash Checks - Singletons - Params', async () => {
    const ioc = new IoCContainer();

    ioc.Register(TestParamsClass, () => new TestParamsClass('World2'));

    ioc.Register(TestParamsClass, () => new TestParamsClass('World3'), {
      Name: 'test',
    });

    ioc.Register(() => new TestParamsClass('World4'), {
      Type: ioc.Symbol($ITestClass),
    });

    ioc.Register(() => new TestParamsClass('World5'), {
      Name: 'test',
      Type: ioc.Symbol($ITestClass),
    });

    const test = await ioc.Resolve<TestParamsClass>(TestParamsClass);

    assertEquals(test.Hello, 'World2');
    assertInstanceOf(test, TestParamsClass);

    const testName = await ioc.Resolve<TestParamsClass>(
      TestParamsClass,
      'test',
    );

    assertEquals(testName.Hello, 'World3');
    assertInstanceOf(testName, TestParamsClass);

    const testSymbol = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));

    assertEquals(testSymbol.Hello, 'World4');
    assertInstanceOf(testSymbol, TestParamsClass);

    const testSymbolName = await ioc.Resolve<ITestClass>(
      ioc.Symbol($ITestClass),
      'test',
    );

    assertEquals(testSymbolName.Hello, 'World5');
    assertInstanceOf(testSymbolName, TestParamsClass);

    assert(
      test !== testName,
      'The singleton instance is clashing with named instance.',
    );
    assert(
      test !== testSymbol,
      'The singleton instance is clashing with symbol instance.',
    );
    assert(
      test !== testSymbolName,
      'The singleton instance is clashing with symbol named instance.',
    );

    assert(
      testName !== testSymbol,
      'The singleton named instance is clashing with symbol instance.',
    );
    assert(
      testName !== testSymbolName,
      'The singleton named instance is clashing with symbol named instance.',
    );

    assert(
      testSymbol !== testSymbolName,
      'The singleton symbol instance is clashing with symbol named instance.',
    );
  });

  await t.step('Clash Checks - Transient - Params', async () => {
    const ioc = new IoCContainer();

    ioc.Register(TestParamsClass, () => new TestParamsClass('World2')), {
      Lifetime: 'transient',
    };

    ioc.Register(TestParamsClass, () => new TestParamsClass('World3'), {
      Lifetime: 'transient',
      Name: 'test',
    });

    ioc.Register(TestParamsClass, () => new TestParamsClass('World4'), {
      Lifetime: 'transient',
      Type: ioc.Symbol($ITestClass),
    });

    ioc.Register(() => new TestParamsClass('World5'), {
      Lifetime: 'transient',
      Name: 'test',
      Type: ioc.Symbol($ITestClass),
    });

    const test = await ioc.Resolve<TestParamsClass>(TestParamsClass);

    assertEquals(test.Hello, 'World2');
    assertInstanceOf(test, TestParamsClass);

    const testName = await ioc.Resolve<TestParamsClass>(
      TestParamsClass,
      'test',
    );

    assertEquals(testName.Hello, 'World3');
    assertInstanceOf(testName, TestParamsClass);

    const testSymbol = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));

    assertEquals(testSymbol.Hello, 'World4');
    assertInstanceOf(testSymbol, TestParamsClass);

    const testSymbolName = await ioc.Resolve<ITestClass>(
      ioc.Symbol($ITestClass),
      'test',
    );

    assertEquals(testSymbolName.Hello, 'World5');
    assertInstanceOf(testSymbolName, TestParamsClass);

    assert(
      test !== testName,
      'The transient instance is clashing with named instance.',
    );
    assert(
      test !== testSymbol,
      'The transient instance is clashing with symbol instance.',
    );
    assert(
      test !== testSymbolName,
      'The transient instance is clashing with symbol named instance.',
    );

    assert(
      testName !== testSymbol,
      'The transient named instance is clashing with symbol instance.',
    );
    assert(
      testName !== testSymbolName,
      'The transient named instance is clashing with symbol named instance.',
    );

    assert(
      testSymbol !== testSymbolName,
      'The transient symbol instance is clashing with symbol named instance.',
    );
  });

  await t.step('Clash Checks - Scoped - Params', async () => {
    const ioc = new IoCContainer();

    const testScope = ioc.Register(
      TestParamsClass,
      () => new TestParamsClass('World2'),
      {
        Lifetime: 'scoped',
      },
    )!;

    const testNameScope = ioc.Register(
      TestParamsClass,
      () => new TestParamsClass('World3'),
      {
        Lifetime: 'scoped',
        Name: 'test',
      },
    )!;

    const testSymbolScope = ioc.Register(
      TestParamsClass,
      () => new TestParamsClass('World4'),
      {
        Lifetime: 'scoped',
        Type: ioc.Symbol($ITestClass),
      },
    )!;

    const testSymbolNameScope = ioc.Register(
      () => new TestParamsClass('World5'),
      {
        Lifetime: 'scoped',
        Name: 'test',
        Type: ioc.Symbol($ITestClass),
      },
    )!;

    const test = await ioc.Resolve<TestParamsClass>(TestParamsClass);

    assertEquals(test.Hello, 'World2');
    assertInstanceOf(test, TestParamsClass);

    const testName = await ioc.Resolve<TestParamsClass>(
      TestParamsClass,
      'test',
    );

    assertEquals(testName.Hello, 'World3');
    assertInstanceOf(testName, TestParamsClass);

    const testSymbol = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));

    assertEquals(testSymbol.Hello, 'World4');
    assertInstanceOf(testSymbol, TestParamsClass);

    const testSymbolName = await ioc.Resolve<ITestClass>(
      ioc.Symbol($ITestClass),
      'test',
    );

    assertEquals(testSymbolName.Hello, 'World5');
    assertInstanceOf(testSymbolName, TestParamsClass);

    assert(
      test !== testName,
      'The scoped instance is clashing with named instance.',
    );
    assert(
      test !== testSymbol,
      'The scoped instance is clashing with symbol instance.',
    );
    assert(
      test !== testSymbolName,
      'The scoped instance is clashing with symbol named instance.',
    );

    assert(
      testName !== testSymbol,
      'The scoped named instance is clashing with symbol instance.',
    );
    assert(
      testName !== testSymbolName,
      'The scoped named instance is clashing with symbol named instance.',
    );

    assert(
      testSymbol !== testSymbolName,
      'The scoped symbol instance is clashing with symbol named instance.',
    );

    testScope();

    await assertRejects(
      async () => {
        await ioc.Resolve(TestParamsClass);
      },
      Error,
      'No Service for symbol',
      'The scoped instance was not destroyed.',
    );

    await ioc.Resolve<TestParamsClass>(TestParamsClass, 'test');
    await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));
    await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass), 'test');

    testNameScope();

    await assertRejects(
      async () => {
        await ioc.Resolve(TestParamsClass, 'test');
      },
      Error,
      'No Service for symbol',
      'The scoped instance was not destroyed.',
    );

    await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));
    await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass), 'test');

    testSymbolScope();

    await assertRejects(
      async () => {
        await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));
      },
      Error,
      'No Service for symbol',
      'The scoped instance was not destroyed.',
    );

    await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass), 'test');

    testSymbolNameScope();

    await assertRejects(
      async () => {
        await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass), 'test');
      },
      Error,
      'No Service for symbol',
      'The scoped instance was not destroyed.',
    );
  });

  await t.step('Clash Checks - Mixed - Params', async () => {
    const ioc = new IoCContainer();

    ioc.Register(TestParamsClass, () => new TestParamsClass('World2'));

    ioc.Register(TestParamsClass, () => new TestParamsClass('World3'), {
      Lifetime: 'transient',
      Name: 'test',
    });

    const testSymbolScope = ioc.Register(() => new TestParamsClass('World4'), {
      Lifetime: 'scoped',
      Type: ioc.Symbol($ITestClass),
    })!;

    const test = await ioc.Resolve<TestParamsClass>(TestParamsClass);

    assertEquals(test.Hello, 'World2');
    assertInstanceOf(test, TestParamsClass);

    const testName = await ioc.Resolve<TestParamsClass>(
      TestParamsClass,
      'test',
    );

    assertEquals(testName.Hello, 'World3');
    assertInstanceOf(testName, TestParamsClass);

    const testSymbol = await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));

    assertEquals(testSymbol.Hello, 'World4');
    assertInstanceOf(testSymbol, TestParamsClass);

    assert(
      test !== testName,
      'The scoped instance is clashing with named instance.',
    );
    assert(
      test !== testSymbol,
      'The scoped instance is clashing with symbol instance.',
    );

    assert(
      testName !== testSymbol,
      'The scoped named instance is clashing with symbol instance.',
    );

    testSymbolScope();

    await assertRejects(
      async () => {
        await ioc.Resolve<ITestClass>(ioc.Symbol($ITestClass));
      },
      Error,
      'No Service for symbol',
      'The scoped instance was not destroyed.',
    );

    const testB = await ioc.Resolve<TestParamsClass>(TestParamsClass);
    const testNameB = await ioc.Resolve<TestParamsClass>(
      TestParamsClass,
      'test',
    );

    assert(test === testB);
    assert(test !== testNameB);
    assert(testName !== testNameB);
  });

  await t.step('CopyTo', async () => {
    const ioc = new IoCContainer();

    const iocB = new IoCContainer();

    ioc.Register(TestDefaultClass, () => new TestDefaultClass());

    ioc.Register(TestParamsClass, () => new TestParamsClass('WorldA'));

    iocB.Register(TestParamsClass, () => new TestParamsClass('WorldB'));

    ioc.Register(TestParamsClass, () => new TestParamsClass('WorldA'), {
      Lifetime: 'transient',
      Name: 'test',
    });

    iocB.Register(TestParamsClass, () => new TestParamsClass('WorldB'), {
      Name: 'test',
    });

    ioc.Register(() => new TestDefaultClass(), {
      Name: 'test',
      Type: ioc.Symbol($ITestClass),
    });

    iocB.Register(() => new TestParamsClass('WorldB'), {
      Name: 'test',
      Type: iocB.Symbol($ITestClass),
    });

    iocB.Register(() => new TestParamsClass('World2B'), {
      Name: 'test2',
      Type: iocB.Symbol($ITestClass),
    });

    iocB.CopyTo(ioc);

    const testDef = await ioc.Resolve(TestDefaultClass);

    assertEquals(testDef.Hello, 'World');
    assertInstanceOf(testDef, TestDefaultClass);

    const test = await ioc.Resolve(TestParamsClass);

    assertEquals(test.Hello, 'WorldB');
    assertInstanceOf(test, TestParamsClass);

    const testName = await ioc.Resolve(TestParamsClass, 'test');

    const testName2 = await ioc.Resolve(TestParamsClass, 'test');

    assertEquals(testName.Hello, 'WorldB');
    assertEquals(testName2.Hello, 'WorldB');
    assertInstanceOf(testName, TestParamsClass);
    assert(testName === testName2, 'The singleto instance is clashing.');

    const testSymbolName = await ioc.Resolve<ITestClass>(
      ioc.Symbol($ITestClass),
      'test',
    );

    assertEquals(testSymbolName.Hello, 'WorldB');
    assertInstanceOf(testSymbolName, TestParamsClass);

    const test2SymbolName = await ioc.Resolve<ITestClass>(
      ioc.Symbol($ITestClass),
      'test2',
    );

    assertEquals(test2SymbolName.Hello, 'World2B');
    assertInstanceOf(test2SymbolName, TestParamsClass);
  });
});

export const $ITestClass = 'ITestClass';
export interface ITestClass {
  Hello: string;
}

export class TestDefaultClass implements ITestClass {
  public Hello: string = 'World';
}

export class TestParamsClass implements ITestClass {
  constructor(public Hello: string) {}
}

export interface Warrior {
  fight(): string;

  // sneak(): string;
}

export interface Weapon {
  hit(): string;
}

export interface ThrowableWeapon {
  throw(): string;
}

// class Katana implements Weapon {
//   public hit() {
//     return "cut!";
//   }
// }

// class Shuriken implements ThrowableWeapon {
//   public throw() {
//     return "hit!";
//   }
// }

// class Ninja implements Warrior {
//   // public constructor(
//   //   proteckatana: Weapon,
//   //   shuriken: ThrowableWeapon
//   // ) {}

//   public fight() {
//     return "cut!";
//     // return this.katana.hit();
//   }

//   // public sneak() {
//   //   return this.shuriken.throw();
//   // }
// }
