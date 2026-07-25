import { z } from "zod";

const NO_VALUE = Symbol("no value");

export async function readFile<T>(
    path: string,
    schema: z.ZodType<T>,
    parser: (raw: string) => object = JSON.parse,
    defaultValue: T | typeof NO_VALUE = NO_VALUE,
): Promise<T> {
    if (!(await Bun.file(path).exists())) {
        if (defaultValue === NO_VALUE) throw new Error(`File not found: ${path}`);

        await Bun.file(path).write(JSON.stringify(defaultValue, null, 2));

        return defaultValue;
    }

    const file = await Bun.file(path).text();
    const parsed = schema.safeParse(parser(file));

    if (!parsed.success) {
        if (defaultValue === NO_VALUE)
            throw new Error(`Invalid data in ${path}: ${parsed.error.message}`);

        console.warn(
            `Invalid data in ${path}, resetting to default value.`,
            z.treeifyError(parsed.error),
        );
        await Bun.file(path).write(JSON.stringify(defaultValue, null, 2));

        return defaultValue;
    }

    return parsed.data;
}
