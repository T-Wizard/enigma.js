import errorInterceptor from '../../../../src/interceptors/response/error';

describe('Response interceptor: Error', () => {
  it('should throw if the response contains an error', () => {
    try {
      errorInterceptor({}, {}, { error: { code: 2, parameter: 'param', message: 'msg' } });
      expect(true, 'error interceptor did not throw');
    } catch (err) {
      expect(err instanceof Error).to.equal(true);
      expect(err.code).to.equal(2);
      expect(err.parameter).to.equal('param');
      expect(err.message).to.equal('msg');
      expect(err.stack).to.be.a('string');
      // check if the test file is included in the stack trace:
      expect(err.stack.indexOf('error.spec.js')).to.not.equal(-1);
    }
  });

  it('should not reject if the response does not contain any error', () => {
    const response = {};
    expect(errorInterceptor({}, {}, response)).to.equal(response);
  });
});
